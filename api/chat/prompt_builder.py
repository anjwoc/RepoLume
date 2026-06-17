"""System prompt construction, file content loading, and final prompt assembly."""
import json
import logging
import os
import re
from api.config import configs
from api.data_pipeline import get_file_content
from api.prompts import (
    DEEP_RESEARCH_FINAL_ITERATION_PROMPT,
    DEEP_RESEARCH_FIRST_ITERATION_PROMPT,
    DEEP_RESEARCH_INTERMEDIATE_ITERATION_PROMPT,
    SIMPLE_CHAT_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)

_FILE_CONTENT_MAX_CHARS = 8_000
_TOTAL_CONTENT_MAX_CHARS = 40_000


def detect_deep_research(messages: list) -> tuple[bool, int]:
    """Return (is_deep_research, iteration_number). Strips the tag from the last user message."""
    is_deep = any(
        hasattr(m, "content") and m.content and "[DEEP RESEARCH]" in m.content
        for m in messages
    )
    if not is_deep:
        return False, 1
    for msg in messages:
        if hasattr(msg, "content") and msg.content and "[DEEP RESEARCH]" in msg.content:
            if msg is messages[-1]:
                msg.content = msg.content.replace("[DEEP RESEARCH]", "").strip()
    iteration = sum(1 for m in messages if m.role == "assistant") + 1
    return True, iteration


def build_system_prompt(request, is_deep_research: bool, research_iteration: int) -> str:
    """Build system prompt. Returns '' for wiki generation (no chat prompt needed)."""
    if request.is_wiki_generation:
        return ""

    repo_url = request.repo_url
    repo_name = repo_url.split("/")[-1] if "/" in repo_url else repo_url
    repo_type = request.type
    language_code = request.language or configs["lang_config"]["default"]
    language_name = configs["lang_config"]["supported_languages"].get(language_code, "English")

    if not is_deep_research:
        return SIMPLE_CHAT_SYSTEM_PROMPT.format(
            repo_type=repo_type, repo_url=repo_url,
            repo_name=repo_name, language_name=language_name,
        )

    if research_iteration == 1:
        return DEEP_RESEARCH_FIRST_ITERATION_PROMPT.format(
            repo_type=repo_type, repo_url=repo_url,
            repo_name=repo_name, language_name=language_name,
        )
    if research_iteration >= 5:
        return DEEP_RESEARCH_FINAL_ITERATION_PROMPT.format(
            repo_type=repo_type, repo_url=repo_url,
            repo_name=repo_name, research_iteration=research_iteration,
            language_name=language_name,
        )
    return DEEP_RESEARCH_INTERMEDIATE_ITERATION_PROMPT.format(
        repo_type=repo_type, repo_url=repo_url,
        repo_name=repo_name, research_iteration=research_iteration,
        language_name=language_name,
    )


def load_file_content(request) -> str:
    """Load file content for filePath or wiki source files from the request."""
    file_content = ""

    if not request.is_wiki_generation and request.filePath:
        try:
            raw = get_file_content(request.repo_url, request.filePath, request.type, request.token)
            file_content = (
                f'<currentFileContent path="{request.filePath}">\n{raw}\n</currentFileContent>\n\n'
            )
            logger.info(f"Successfully retrieved content for file: {request.filePath}")
        except Exception as e:
            logger.error(f"Error retrieving file content: {str(e)}")
        return file_content

    if request.is_wiki_generation:
        real_repo_path = _resolve_local_repo_path(request)
        query = request.messages[-1].content if request.messages else ""
        match = re.search(r"Source files to base content on:\n(.*?)\n\n", query, re.DOTALL)
        if match:
            for fp in match.group(1).split("\n"):
                fp = fp.strip()
                if not fp:
                    continue
                if len(file_content) >= _TOTAL_CONTENT_MAX_CHARS:
                    logger.warning(f"Total file content budget exceeded, skipping {fp}")
                    break
                try:
                    content_str = get_file_content(real_repo_path, fp, request.type, request.token)
                    if len(content_str) > _FILE_CONTENT_MAX_CHARS:
                        content_str = content_str[:_FILE_CONTENT_MAX_CHARS] + "\n... (truncated)"
                    file_content += f'<file path="{fp}">\n{content_str}\n</file>\n\n'
                except Exception as e:
                    logger.error(f"Error retrieving wiki source file {fp}: {str(e)}")

    return file_content


def _resolve_local_repo_path(request) -> str:
    real_repo_path = request.repo_url
    if request.type == "local" and not os.path.isabs(request.repo_url):
        try:
            from api.routes.cache import get_wiki_cache_path
            owner, repo = (
                request.repo_url.split("/", 1)
                if "/" in request.repo_url
                else ("local", request.repo_url)
            )
            cache_path = get_wiki_cache_path(owner, repo, "local", request.language or "ko", request.model)
            if os.path.exists(cache_path):
                with open(cache_path, "r", encoding="utf-8") as f:
                    cache_data = json.load(f)
                    repo_info = cache_data.get("repo", {})
                    real_repo_path = (
                        repo_info.get("localPath")
                        or repo_info.get("repoUrl")
                        or real_repo_path
                    )
        except Exception as e:
            logger.error(f"Failed to resolve local repo path: {e}")
    return real_repo_path


def assemble_prompt(
    request,
    system_prompt: str,
    context_text: str,
    file_content: str,
    conversation_history: str,
    query: str,
) -> str:
    """Assemble the final prompt from all components."""
    if request.is_wiki_generation:
        source_context = f"<source_files>\n{file_content}</source_files>\n\n" if file_content.strip() else ""
        return (
            f"/no_think\n\n{source_context}{query}\n\n"
            "CRITICAL: DO NOT use any tools to create or write files. "
            "Output ONLY the final content directly to stdout. "
            "Do NOT use ask_question or prompt the user. "
            "Make reasonable assumptions. No conversational filler.\n\n"
            "Assistant: "
        )

    prompt = f"/no_think {system_prompt}\n\n"
    if conversation_history:
        prompt += f"<conversation_history>\n{conversation_history}</conversation_history>\n\n"
    if file_content:
        prompt += f'<currentFileContent path="{request.filePath}">\n{file_content}\n</currentFileContent>\n\n'
    if context_text.strip():
        prompt += f"<START_OF_CONTEXT>\n{context_text}\n<END_OF_CONTEXT>\n\n"
    else:
        prompt += "<note>Answering without retrieval augmentation.</note>\n\n"
    prompt += f"<query>\n{query}\n</query>\n\nAssistant: "
    return prompt


def assemble_fallback_prompt(
    request,
    system_prompt: str,
    conversation_history: str,
    file_content: str,
    query: str,
) -> str:
    """Simplified prompt without RAG context (used on token overflow)."""
    prompt = f"/no_think {system_prompt}\n\n"
    if conversation_history:
        prompt += f"<conversation_history>\n{conversation_history}</conversation_history>\n\n"
    if request.filePath and file_content:
        prompt += f'<currentFileContent path="{request.filePath}">\n{file_content}\n</currentFileContent>\n\n'
    prompt += "<note>Answering without retrieval augmentation due to input size constraints.</note>\n\n"
    prompt += f"<query>\n{query}\n</query>\n\nAssistant: "
    return prompt
