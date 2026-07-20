import asyncio
import json
import logging
import os
import glob
import tempfile
from pathlib import Path
from typing import List, Optional
from urllib.parse import unquote

import google.generativeai as genai
from adalflow.core.types import ModelType
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from api.config import get_model_config, configs, OPENROUTER_API_KEY, OPENAI_API_KEY
from api.data_pipeline import count_tokens, get_file_content
from api.openai_client import OpenAIClient
from api.openrouter_client import OpenRouterClient
from api.rag import RAG
from api.prompts import (
    DEEP_RESEARCH_FIRST_ITERATION_PROMPT,
    DEEP_RESEARCH_FINAL_ITERATION_PROMPT,
    DEEP_RESEARCH_INTERMEDIATE_ITERATION_PROMPT,
    SIMPLE_CHAT_SYSTEM_PROMPT
)
from api.task_streams import emit_task_event

# Configure logging
from api.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


# NOTE: This module is NOT a standalone FastAPI app. The real app lives in
# api/server.py, which mounts chat_completions_stream via add_api_route and
# configures CORS there. This file only provides the request model + handler.

# Models for the API
class ChatMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str

class ChatCompletionRequest(BaseModel):
    """
    Model for requesting a chat completion.
    """
    repo_url: str = Field(..., description="URL of the repository to query")
    messages: List[ChatMessage] = Field(..., description="List of chat messages")
    filePath: Optional[str] = Field(None, description="Optional path to a file in the repository to include in the prompt")
    token: Optional[str] = Field(None, description="Personal access token for private repositories")
    type: Optional[str] = Field("github", description="Type of repository (e.g., 'github', 'gitlab', 'bitbucket')")

    # model parameters
    provider: str = Field("google", description="Model provider (google, openai, openrouter)")
    model: Optional[str] = Field(None, description="Model name for the specified provider")

    language: Optional[str] = Field("en", description="Language for content generation (e.g., 'en', 'ja', 'zh', 'es', 'kr', 'vi')")
    excluded_dirs: Optional[str] = Field(None, description="Comma-separated list of directories to exclude from processing")
    excluded_files: Optional[str] = Field(None, description="Comma-separated list of file patterns to exclude from processing")
    included_dirs: Optional[str] = Field(None, description="Comma-separated list of directories to include exclusively")
    included_files: Optional[str] = Field(None, description="Comma-separated list of file patterns to include exclusively")
    stream_id: Optional[str] = Field(None, description="Optional task log stream id for side-channel progress events")
    skip_rag: Optional[bool] = Field(False, description="Skip RAG initialization and document retrieval")
    litellm_base_url: Optional[str] = Field(None, description="If set, route requests to this litellm proxy")
    api_key: Optional[str] = Field(None, description="API key override (used when mode=api and key provided via UI)")
    use_cli: Optional[bool] = Field(False, description="If True, use local CLI tool (gemini/codex/claude) instead of direct API call")
    cli_tool: Optional[str] = Field(None, description="Which CLI tool to use: 'gemini', 'codex', 'claude'")
    is_wiki_generation: Optional[bool] = Field(False, description="If True, skip chat-specific system prompts")
    async_mode: Optional[bool] = Field(False, description="Run in background and return job_id immediately")

async def chat_completions_stream(request: ChatCompletionRequest):
    """Stream a chat completion response directly using Google Generative AI"""
    try:
        await emit_task_event(
            request.stream_id,
            "task_status",
            "Chat completion request received",
            phase="chat",
            data={"provider": request.provider, "model": request.model, "repo_url": request.repo_url},
        )
        # Check if request contains very large input
        input_too_large = False
        if request.messages and len(request.messages) > 0:
            last_message = request.messages[-1]
            if hasattr(last_message, 'content') and last_message.content:
                tokens = count_tokens(last_message.content, False)
                logger.info(f"Request size: {tokens} tokens")
                await emit_task_event(
                    request.stream_id,
                    "task_status",
                    f"Request size: {tokens} tokens",
                    phase="chat",
                    data={"tokens": tokens},
                )
                if tokens > 8000:
                    logger.warning(f"Request exceeds recommended token limit ({tokens} > 7500)")
                    await emit_task_event(
                        request.stream_id,
                        "task_status",
                        "Request exceeds recommended token limit",
                        phase="chat",
                        data={"tokens": tokens, "recommended_limit": 7500},
                    )
                    input_too_large = True

        # Only create RAG if we actually need it
        if not request.skip_rag:
            try:
                request_rag = RAG(provider=request.provider, model=request.model)

                # Extract custom file filter parameters if provided
                excluded_dirs = None
                excluded_files = None
                included_dirs = None
                included_files = None

                if request.excluded_dirs:
                    excluded_dirs = [unquote(dir_path) for dir_path in request.excluded_dirs.split('\n') if dir_path.strip()]
                    logger.info(f"Using custom excluded directories: {excluded_dirs}")
                if request.excluded_files:
                    excluded_files = [unquote(file_pattern) for file_pattern in request.excluded_files.split('\n') if file_pattern.strip()]
                    logger.info(f"Using custom excluded files: {excluded_files}")
                if request.included_dirs:
                    included_dirs = [unquote(dir_path) for dir_path in request.included_dirs.split('\n') if dir_path.strip()]
                    logger.info(f"Using custom included directories: {included_dirs}")
                if request.included_files:
                    included_files = [unquote(file_pattern) for file_pattern in request.included_files.split('\n') if file_pattern.strip()]
                    logger.info(f"Using custom included files: {included_files}")

                await emit_task_event(
                    request.stream_id,
                    "phase_start",
                    "Preparing retriever",
                    phase="retriever",
                    data={"repo_url": request.repo_url, "repo_type": request.type},
                )
                request_rag.prepare_retriever(request.repo_url, request.type, request.token, excluded_dirs, excluded_files, included_dirs, included_files)
                logger.info(f"Retriever prepared for {request.repo_url}")
                await emit_task_event(
                    request.stream_id,
                    "phase_complete",
                    "Retriever prepared",
                    phase="retriever",
                    data={"repo_url": request.repo_url},
                )
            except ValueError as e:
                if "No valid documents with embeddings found" in str(e):
                    logger.error(f"No valid embeddings found: {str(e)}")
                    await emit_task_event(request.stream_id, "error", "No valid document embeddings found", phase="retriever")
                    raise HTTPException(status_code=500, detail="No valid document embeddings found.")
                else:
                    logger.error(f"ValueError preparing retriever: {str(e)}")
                    await emit_task_event(request.stream_id, "error", f"Error preparing retriever: {str(e)}", phase="retriever")
                    raise HTTPException(status_code=500, detail=f"Error preparing retriever: {str(e)}")
            except Exception as e:
                logger.error(f"Error preparing retriever: {str(e)}")
                await emit_task_event(request.stream_id, "error", f"Error preparing retriever: {str(e)}", phase="retriever")
                raise HTTPException(status_code=500, detail=f"Error preparing retriever: {str(e)}")
        else:
            request_rag = None
            logger.info("skip_rag=True: skipping RAG initialization entirely")

        # Validate request
        if not request.messages or len(request.messages) == 0:
            raise HTTPException(status_code=400, detail="No messages provided")

        last_message = request.messages[-1]
        if last_message.role != "user":
            raise HTTPException(status_code=400, detail="Last message must be from the user")

        # Process previous messages to build conversation history
        for i in range(0, len(request.messages) - 1, 2):
            if i + 1 < len(request.messages):
                user_msg = request.messages[i]
                assistant_msg = request.messages[i + 1]

                if user_msg.role == "user" and assistant_msg.role == "assistant" and request_rag is not None:
                    request_rag.memory.add_dialog_turn(
                        user_query=user_msg.content,
                        assistant_response=assistant_msg.content
                    )

        # Check if this is a Deep Research request
        is_deep_research = False
        research_iteration = 1

        # Process messages to detect Deep Research requests
        for msg in request.messages:
            if hasattr(msg, 'content') and msg.content and "[DEEP RESEARCH]" in msg.content:
                is_deep_research = True
                # Only remove the tag from the last message
                if msg == request.messages[-1]:
                    # Remove the Deep Research tag
                    msg.content = msg.content.replace("[DEEP RESEARCH]", "").strip()

        # Count research iterations if this is a Deep Research request
        if is_deep_research:
            research_iteration = sum(1 for msg in request.messages if msg.role == 'assistant') + 1
            logger.info(f"Deep Research request detected - iteration {research_iteration}")

            # Check if this is a continuation request
            if "continue" in last_message.content.lower() and "research" in last_message.content.lower():
                # Find the original topic from the first user message
                original_topic = None
                for msg in request.messages:
                    if msg.role == "user" and "continue" not in msg.content.lower():
                        original_topic = msg.content.replace("[DEEP RESEARCH]", "").strip()
                        logger.info(f"Found original research topic: {original_topic}")
                        break

                if original_topic:
                    # Replace the continuation message with the original topic
                    last_message.content = original_topic
                    logger.info(f"Using original topic for research: {original_topic}")

        # Get the query from the last message
        query = last_message.content

        # Only retrieve documents if input is not too large
        context_text = ""
        retrieved_documents = None

        if not input_too_large and not request.skip_rag:
            try:
                # If filePath exists, modify the query for RAG to focus on the file
                rag_query = query
                if request.filePath:
                    # Use the file path to get relevant context about the file
                    rag_query = f"Contexts related to {request.filePath}"
                    logger.info(f"Modified RAG query to focus on file: {request.filePath}")

                # Try to perform RAG retrieval
                try:
                    await emit_task_event(
                        request.stream_id,
                        "phase_start",
                        "Retrieving repository context",
                        phase="rag",
                        data={"file_path": request.filePath},
                    )
                    # This will use the actual RAG implementation
                    retrieved_documents = request_rag(rag_query, language=request.language)

                    if retrieved_documents and retrieved_documents[0].documents:
                        # Format context for the prompt in a more structured way
                        documents = retrieved_documents[0].documents
                        logger.info(f"Retrieved {len(documents)} documents")
                        await emit_task_event(
                            request.stream_id,
                            "phase_complete",
                            f"Retrieved {len(documents)} documents",
                            phase="rag",
                            data={"document_count": len(documents)},
                        )

                        # Group documents by file path
                        docs_by_file = {}
                        for doc in documents:
                            file_path = doc.meta_data.get('file_path', 'unknown')
                            if file_path not in docs_by_file:
                                docs_by_file[file_path] = []
                            docs_by_file[file_path].append(doc)

                        # Format context text with file path grouping
                        context_parts = []
                        for file_path, docs in docs_by_file.items():
                            # Add file header with metadata
                            header = f"## File Path: {file_path}\n\n"
                            # Add document content
                            content = "\n\n".join([doc.text for doc in docs])

                            context_parts.append(f"{header}{content}")

                        # Join all parts with clear separation
                        context_text = "\n\n" + "-" * 10 + "\n\n".join(context_parts)
                    else:
                        logger.warning("No documents retrieved from RAG")
                        await emit_task_event(
                            request.stream_id,
                            "phase_complete",
                            "No documents retrieved from RAG",
                            phase="rag",
                            data={"document_count": 0},
                        )
                except Exception as e:
                    logger.error(f"Error in RAG retrieval: {str(e)}")
                    await emit_task_event(request.stream_id, "error", f"Error in RAG retrieval: {str(e)}", phase="rag")
                    # Continue without RAG if there's an error

            except Exception as e:
                logger.error(f"Error retrieving documents: {str(e)}")
                await emit_task_event(request.stream_id, "error", f"Error retrieving documents: {str(e)}", phase="rag")
                context_text = ""

        # Get repository information
        repo_url = request.repo_url
        repo_name = repo_url.split("/")[-1] if "/" in repo_url else repo_url

        # Determine repository type
        repo_type = request.type

        # Get language information
        language_code = request.language or configs["lang_config"]["default"]
        supported_langs = configs["lang_config"]["supported_languages"]
        language_name = supported_langs.get(language_code, "English")

        # Create system prompt
        if is_deep_research:
            # Check if this is the first iteration
            is_first_iteration = research_iteration == 1

            # Check if this is the final iteration
            is_final_iteration = research_iteration >= 5

            if is_first_iteration:
                system_prompt = DEEP_RESEARCH_FIRST_ITERATION_PROMPT.format(
                    repo_type=repo_type,
                    repo_url=repo_url,
                    repo_name=repo_name,
                    language_name=language_name
                )
            elif is_final_iteration:
                system_prompt = DEEP_RESEARCH_FINAL_ITERATION_PROMPT.format(
                    repo_type=repo_type,
                    repo_url=repo_url,
                    repo_name=repo_name,
                    research_iteration=research_iteration,
                    language_name=language_name
                )
            else:
                system_prompt = DEEP_RESEARCH_INTERMEDIATE_ITERATION_PROMPT.format(
                    repo_type=repo_type,
                    repo_url=repo_url,
                    repo_name=repo_name,
                    research_iteration=research_iteration,
                    language_name=language_name
                )
        else:
            system_prompt = SIMPLE_CHAT_SYSTEM_PROMPT.format(
                repo_type=repo_type,
                repo_url=repo_url,
                repo_name=repo_name,
                language_name=language_name
            )

        if getattr(request, "is_wiki_generation", False):
            system_prompt = "" # Skip chat system prompts for wiki generation to prevent contradictory instructions


        # Fetch file content if provided
        file_content = ""
        if request.filePath:
            try:
                file_content = f"<currentFileContent path=\"{request.filePath}\">\n"
                file_content += get_file_content(request.repo_url, request.filePath, request.type, request.token)
                file_content += "\n</currentFileContent>\n\n"
                logger.info(f"Successfully retrieved content for file: {request.filePath}")
            except Exception as e:
                logger.error(f"Error retrieving file content: {str(e)}")

        if getattr(request, "is_wiki_generation", False):
            real_repo_path = request.repo_url
            if request.type == "local" and not __import__("os").path.isabs(request.repo_url):


                owner, repo = request.repo_url.split("/", 1) if "/" in request.repo_url else ("local", request.repo_url)
                resolved = None

                # ── 1순위: SQLite DB 조회 (항상 정확한 절대 경로 보장) ──────────
                try:
                    from api.db import get_project_local_path
                    resolved = get_project_local_path(owner, repo)
                    if resolved:
                        logger.info(f"[db] 소스 경로 확인: {owner}/{repo} → {resolved}")
                except Exception as _dbe:
                    logger.debug(f"[db] DB 조회 실패, 캐시 폴백: {_dbe}")

                # ── 2순위: JSON 캐시 파일 폴백 (DB miss 또는 DB 미초기화) ──────
                if not resolved:
                    try:
                        from api.server import get_wiki_cache_path, WIKI_CACHE_DIR

                        def _extract_local_path(cache_file: str):
                            try:
                                with open(cache_file, "r", encoding="utf-8") as f:
                                    d = json.load(f)
                                r = d.get("repo", {})
                                for key in ("localPath", "repoUrl"):
                                    v = r.get(key, "")
                                    if v and os.path.isabs(v) and os.path.isdir(v):
                                        return v
                            except Exception:
                                pass
                            return None

                        for lang_try in [request.language, "en", "ko"]:
                            if not lang_try:
                                continue
                            cp = get_wiki_cache_path(owner, repo, "local", lang_try, request.model)
                            if os.path.exists(cp):
                                resolved = _extract_local_path(cp)
                                if resolved:
                                    break
                        if not resolved:
                            pattern = os.path.join(WIKI_CACHE_DIR, f"localwiki_cache_local_{owner}_{repo}_*.json")
                            for cp in glob.glob(pattern):
                                resolved = _extract_local_path(cp)
                                if resolved:
                                    break
                    except Exception as e:
                        logger.error(f"Failed to resolve local repo path from cache: {e}")

                if resolved:
                    real_repo_path = resolved
                else:
                    logger.warning(f"Could not resolve absolute localPath for {owner}/{repo}; skipping source file injection")

            import re as _re
            match = _re.search(r"Source files to base content on:\n(.*?)\n\n", query, _re.DOTALL)
            # 절대 경로를 확보한 경우에만 소스 파일 첨부 (상대 경로면 건너뜀)
            if match and __import__("os").path.isabs(real_repo_path):
                for fp in match.group(1).split('\n'):
                    fp = fp.strip()
                    if not fp: continue
                    try:
                        content_str = get_file_content(real_repo_path, fp, request.type, request.token)
                        file_content += f"<file path=\"{fp}\">\n{content_str}\n</file>\n\n"
                        logger.info(f"Successfully retrieved wiki source file: {fp}")
                    except Exception as e:
                        logger.error(f"Error retrieving wiki source file {fp}: {str(e)}")

        # Format conversation history
        conversation_history = ""
        if request_rag is not None:
            for turn_id, turn in request_rag.memory().items():
                if not isinstance(turn_id, int) and hasattr(turn, 'user_query') and hasattr(turn, 'assistant_response'):
                    conversation_history += f"<turn>\n<user>{turn.user_query.query_str}</user>\n<assistant>{turn.assistant_response.response_str}</assistant>\n</turn>\n"

        if getattr(request, "is_wiki_generation", False):
            prompt = f"/no_think\n\n{query}\n\nCRITICAL SYSTEM OVERRIDE: YOU ARE A RAW TEXT/JSON GENERATOR. YOU MUST NOT USE ANY TOOLS AT ALL. DO NOT INVOKE list_dir, read_file, search, OR ANY OTHER TOOL. DO NOT OUTPUT ANY THOUGHTS OR CONVERSATIONAL TEXT. IF YOU ARE GENERATING A JSON, OUTPUT EXACTLY ONE JSON OBJECT AND NOTHING ELSE. YOUR VERY FIRST OUTPUT CHARACTER MUST BE THE BEGINNING OF THE CONTENT.\n\nAssistant: "
        else:
            # Create the prompt with context
            prompt = f"/no_think {system_prompt}\n\n"

            if conversation_history:
                prompt += f"<conversation_history>\n{conversation_history}</conversation_history>\n\n"

            # Check if filePath is provided and fetch file content if it exists
            if file_content:
                # Add file content to the prompt after conversation history
                prompt += f"<currentFileContent path=\"{request.filePath}\">\n{file_content}\n</currentFileContent>\n\n"

            # Only include context if it's not empty
            CONTEXT_START = "<START_OF_CONTEXT>"
            CONTEXT_END = "<END_OF_CONTEXT>"
            if context_text.strip():
                prompt += f"{CONTEXT_START}\n{context_text}\n{CONTEXT_END}\n\n"
            else:
                # Add a note that we're skipping RAG due to size constraints or because it's the isolated API
                logger.info("No context available from RAG")
                await emit_task_event(request.stream_id, "task_status", "Answering without retrieval augmentation", phase="rag")
                prompt += "<note>Answering without retrieval augmentation.</note>\n\n"

            prompt += f"<query>\n{query}\n</query>\n\nAssistant: "

        # ── CLI 모드: Go 바이너리(localwiki-agent)로 라우팅 ──────────────
        if request.use_cli:
            agent = request.cli_tool or "codex"
            model_override = request.model or ""

            # Ensure agy models and gemini alias use antigravity agent explicitly
            # Since gemini CLI is aliased to Antigravity IDE on this system, we must use antigravity agent
            # to ensure the CRITICAL INSTRUCTION (non-interactive mode) is appended.
            if agent == "gemini" or (model_override and model_override.startswith("agy-")):
                agent = "antigravity"

            # CLI uses an internal endpoint that doesn't support gemini-3.1-flash
            if agent == "gemini" and model_override == "gemini-3.1-flash":
                model_override = "gemini-3.1-pro-preview"

            # 바이너리 경로 (프로젝트 루트 기준)
            _PROJECT_ROOT = Path(__file__).parent.parent.parent.parent
            agent_bin = _PROJECT_ROOT / "bin" / "repolume-agent"
            if not agent_bin.exists():
                raise HTTPException(status_code=500, detail="repolume-agent 바이너리를 찾을 수 없습니다. 루트의 bin/ 디렉토리를 확인하세요.")

            # 프롬프트를 임시 파일로 저장 (ARG_MAX 초과 방지)
            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as pf:
                pf.write(prompt)
                prompt_file = pf.name

            cmd = [
                str(agent_bin), "run",
                "--agent", agent,
                "--prompt-file", prompt_file,
                "--cwd", request.repo_url if os.path.isdir(request.repo_url) else ".",
                "--stream-jsonl",
                "--timeout", "1200",
            ]
            if model_override:
                cmd += ["--model", model_override]

            logger.info(f"CLI 모드 실행: {' '.join(cmd)}")
            await emit_task_event(request.stream_id, "task_status", f"CLI 모드 ({agent}) 실행 중...", phase="generation")

            env = os.environ.copy()
            # Remove keys that might interfere with gemini CLI's built-in OAuth
            env.pop("GEMINI_API_KEY", None)
            env.pop("GOOGLE_API_KEY", None)
            env.pop("GOOGLE_CLOUD_PROJECT_ID", None)

            if request.api_key:
                if request.provider == "openai":
                    env["OPENAI_API_KEY"] = request.api_key
                elif request.provider == "anthropic":
                    env["ANTHROPIC_API_KEY"] = request.api_key

            async def cli_stream_generator():
                try:
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=env
                    )
                    full_content = []
                    text_buffer = ""
                    async for raw_line in proc.stdout:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue
                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            yield line
                            continue

                        etype = event.get("type", "")
                        if "error" in event and event["error"]:
                            err_msg = event.get("error")
                            logger.error(f"CLI 에이전트 에러: {err_msg}")
                            yield f"\nCLI Error: {err_msg}"
                            if request.stream_id:
                                await emit_task_event(request.stream_id, "error", f"CLI 실패: {err_msg}", phase="generation")
                        elif etype == "chunk":
                            chunk_text = event.get("content", "")
                            text_buffer += chunk_text

                            while "\n" in text_buffer:
                                line_str, text_buffer = text_buffer.split("\n", 1)
                                if line_str.startswith("[NOTE]") or line_str.startswith("Received message:"):
                                    logger.debug(f"Filtered agent internal log: {line_str}")
                                    continue
                                
                                valid_chunk = line_str + "\n"
                                full_content.append(valid_chunk)
                                yield valid_chunk
                                if request.stream_id:
                                    await emit_task_event(request.stream_id, "agent_log", valid_chunk, phase="generation")

                        elif etype == "complete":
                            pass # We handle full content directly
                        elif etype == "status":
                            logger.info(f"CLI status: {event.get('content', '')}")

                    await proc.wait()
                    
                    if text_buffer:
                        if not (text_buffer.startswith("[NOTE]") or text_buffer.startswith("Received message:")):
                            full_content.append(text_buffer)
                            yield text_buffer
                            if request.stream_id:
                                await emit_task_event(request.stream_id, "agent_log", text_buffer, phase="generation")

                    stderr_out = await proc.stderr.read()
                    err_str = stderr_out.decode().strip()

                    if proc.returncode != 0 or (not full_content and err_str):
                        logger.error(f"CLI 에이전트 종료 코드 {proc.returncode}: {err_str}")
                        if request.stream_id:
                            await emit_task_event(request.stream_id, "error", f"CLI 실행 실패: {err_str}", phase="generation")
                        yield f"CLI Error: {err_str}"
                finally:
                    try:
                        os.unlink(prompt_file)
                    except Exception:
                        pass
        # ── CLI 모드 끝 ────────────────────────────────────────────────────
        else:
            model_config = get_model_config(request.provider, request.model)["model_kwargs"]

            if request.provider == "openrouter":
                logger.info(f"Using OpenRouter with model: {request.model}")

                # Check if OpenRouter API key is set
                if not OPENROUTER_API_KEY:
                    logger.warning("OPENROUTER_API_KEY not configured, but continuing with request")
                    # We'll let the OpenRouterClient handle this and return a friendly error message

                model = OpenRouterClient()
                model_kwargs = {
                    "model": request.model,
                    "stream": True,
                    "temperature": model_config["temperature"]
                }
                # Only add top_p if it exists in the model config
                if "top_p" in model_config:
                    model_kwargs["top_p"] = model_config["top_p"]

                api_kwargs = model.convert_inputs_to_api_kwargs(
                    input=prompt,
                    model_kwargs=model_kwargs,
                    model_type=ModelType.LLM
                )
            elif request.provider == "openai" or request.litellm_base_url:
                logger.info(f"Using OpenAI protocol with model: {request.model}")

                if request.litellm_base_url:
                    # Local CLI mode: route through litellm proxy — no real API key needed
                    logger.info(f"Routing to litellm proxy: {request.litellm_base_url}")
                    model = OpenAIClient(
                        api_key="local",  # litellm doesn't need a real key
                        base_url=request.litellm_base_url,
                    )
                else:
                    # API direct mode
                    effective_api_key = request.api_key or OPENAI_API_KEY
                    if not effective_api_key:
                        raise ValueError("OPENAI_API_KEY is not set. Please add it in Settings or set the environment variable.")
                    model = OpenAIClient(api_key=effective_api_key)

                model_kwargs = {
                    "model": request.model,
                    "stream": True,
                    "temperature": model_config.get("temperature", 0.7)
                }
                if "top_p" in model_config:
                    model_kwargs["top_p"] = model_config["top_p"]

                api_kwargs = model.convert_inputs_to_api_kwargs(
                    input=prompt,
                    model_kwargs=model_kwargs,
                    model_type=ModelType.LLM
                )
            else:
                # Initialize Google Generative AI model (default provider)
                model = genai.GenerativeModel(
                    model_name=model_config["model"],
                    generation_config={
                        "temperature": model_config["temperature"],
                        "top_p": model_config["top_p"],
                        "top_k": model_config["top_k"],
                    },
                )

            # Create a streaming response
            async def response_stream():
                try:
                    await emit_task_event(
                        request.stream_id,
                        "phase_start",
                        f"Calling provider {request.provider}",
                        phase="provider",
                        data={"provider": request.provider, "model": request.model},
                    )
                    if request.provider == "openrouter":
                        try:
                            # Get the response and handle it properly using the previously created api_kwargs
                            logger.info("Making OpenRouter API call")
                            response = await model.acall(api_kwargs=api_kwargs, model_type=ModelType.LLM)
                            # Handle streaming response from OpenRouter
                            async for chunk in response:
                                yield chunk
                        except Exception as e_openrouter:
                            logger.error(f"Error with OpenRouter API: {str(e_openrouter)}")
                            yield f"\nError with OpenRouter API: {str(e_openrouter)}\n\nPlease check that you have set the OPENROUTER_API_KEY environment variable with a valid API key."
                    elif request.provider == "openai":
                        try:
                            # Get the response and handle it properly using the previously created api_kwargs
                            logger.info("Making Openai API call")
                            response = await model.acall(api_kwargs=api_kwargs, model_type=ModelType.LLM)
                            # Handle streaming response from Openai
                            async for chunk in response:
                               choices = getattr(chunk, "choices", [])
                               if len(choices) > 0:
                                   delta = getattr(choices[0], "delta", None)
                                   if delta is not None:
                                        text = getattr(delta, "content", None)
                                        if text is not None:
                                            yield text
                        except Exception as e_openai:
                            logger.error(f"Error with Openai API: {str(e_openai)}")
                            yield f"\nError with Openai API: {str(e_openai)}\n\nPlease check that you have set the OPENAI_API_KEY environment variable with a valid API key."
                    else:
                        # Google Generative AI (default provider)
                        response = model.generate_content(prompt, stream=True)
                        for chunk in response:
                            if hasattr(chunk, "text"):
                                yield chunk.text

                except Exception as e_outer:
                    logger.error(f"Error in streaming response: {str(e_outer)}")
                    await emit_task_event(request.stream_id, "error", f"Error in streaming response: {str(e_outer)}", phase="provider")
                    error_message = str(e_outer)

                    # Check for token limit errors
                    if "maximum context length" in error_message or "token limit" in error_message or "too many tokens" in error_message:
                        # If we hit a token limit error, try again without context
                        logger.warning("Token limit exceeded, retrying without context")
                        try:
                            # Create a simplified prompt without context
                            simplified_prompt = f"/no_think {system_prompt}\n\n"
                            if conversation_history:
                                simplified_prompt += f"<conversation_history>\n{conversation_history}</conversation_history>\n\n"

                            # Include file content in the fallback prompt if it was retrieved
                            if request.filePath and file_content:
                                simplified_prompt += f"<currentFileContent path=\"{request.filePath}\">\n{file_content}\n</currentFileContent>\n\n"

                            simplified_prompt += "<note>Answering without retrieval augmentation due to input size constraints.</note>\n\n"
                            simplified_prompt += f"<query>\n{query}\n</query>\n\nAssistant: "

                            if request.provider == "openrouter":
                                try:
                                    # Create new api_kwargs with the simplified prompt
                                    fallback_api_kwargs = model.convert_inputs_to_api_kwargs(
                                        input=simplified_prompt,
                                        model_kwargs=model_kwargs,
                                        model_type=ModelType.LLM
                                    )

                                    # Get the response using the simplified prompt
                                    logger.info("Making fallback OpenRouter API call")
                                    fallback_response = await model.acall(api_kwargs=fallback_api_kwargs, model_type=ModelType.LLM)

                                    # Handle streaming fallback_response from OpenRouter
                                    async for chunk in fallback_response:
                                        yield chunk
                                except Exception as e_fallback:
                                    logger.error(f"Error with OpenRouter API fallback: {str(e_fallback)}")
                                    yield f"\nError with OpenRouter API fallback: {str(e_fallback)}\n\nPlease check that you have set the OPENROUTER_API_KEY environment variable with a valid API key."
                            elif request.provider == "openai":
                                try:
                                    # Create new api_kwargs with the simplified prompt
                                    fallback_api_kwargs = model.convert_inputs_to_api_kwargs(
                                        input=simplified_prompt,
                                        model_kwargs=model_kwargs,
                                        model_type=ModelType.LLM
                                    )

                                    # Get the response using the simplified prompt
                                    logger.info("Making fallback Openai API call")
                                    fallback_response = await model.acall(api_kwargs=fallback_api_kwargs, model_type=ModelType.LLM)

                                    # Handle streaming fallback_response from Openai
                                    async for chunk in fallback_response:
                                        text = chunk if isinstance(chunk, str) else getattr(chunk, 'text', str(chunk))
                                        yield text
                                except Exception as e_fallback:
                                    logger.error(f"Error with Openai API fallback: {str(e_fallback)}")
                                    yield f"\nError with Openai API fallback: {str(e_fallback)}\n\nPlease check that you have set the OPENAI_API_KEY environment variable with a valid API key."
                            else:
                                # Google Generative AI fallback (default provider)
                                model_config = get_model_config(request.provider, request.model)
                                fallback_model = genai.GenerativeModel(
                                    model_name=model_config["model_kwargs"]["model"],
                                    generation_config={
                                        "temperature": model_config["model_kwargs"].get("temperature", 0.7),
                                        "top_p": model_config["model_kwargs"].get("top_p", 0.8),
                                        "top_k": model_config["model_kwargs"].get("top_k", 40),
                                    },
                                )

                                fallback_response = fallback_model.generate_content(
                                    simplified_prompt, stream=True
                                )
                                for chunk in fallback_response:
                                    if hasattr(chunk, "text"):
                                        yield chunk.text
                        except Exception as e2:
                            logger.error(f"Error in fallback streaming response: {str(e2)}")
                            yield f"\nI apologize, but your request is too large for me to process. Please try a shorter query or break it into smaller parts."
                    else:
                        # For other errors, return the error message
                        yield f"\nError: {error_message}"
                finally:
                    await emit_task_event(
                        request.stream_id,
                        "complete",
                        "Chat completion stream finished",
                        phase="chat",
                        data={"provider": request.provider, "model": request.model},
                    )

        # Run in background if async_mode is True
        if request.async_mode and request.stream_id:
            async def background_task(gen):
                try:
                    async for chunk in gen:
                        if chunk and isinstance(chunk, str):
                            # The stream generators yield raw text strings
                            await emit_task_event(request.stream_id, "chunk", data={"content": chunk})
                except Exception as e_bg:
                    logger.error(f"Background stream error: {e_bg}")
                    await emit_task_event(request.stream_id, "error", f"Background stream error: {str(e_bg)}", phase="generation")
                finally:
                    # Always emit complete so the frontend EventSource can resolve cleanly
                    await emit_task_event(
                        request.stream_id,
                        "complete",
                        "Stream finished",
                        phase="chat",
                    )

            stream_gen = cli_stream_generator() if request.use_cli else response_stream()
            asyncio.create_task(background_task(stream_gen))
            from fastapi.responses import JSONResponse
            return JSONResponse({"status": "queued", "job_id": request.stream_id})

        # Return streaming response synchronously
        stream_gen = cli_stream_generator() if request.use_cli else response_stream()
        return StreamingResponse(stream_gen, media_type="text/plain" if request.use_cli else "text/event-stream")

    except HTTPException:
        raise
    except Exception as e_handler:
        error_msg = f"Error in streaming chat completion: {str(e_handler)}"
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)
