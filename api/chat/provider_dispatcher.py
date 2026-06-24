"""LLM provider dispatch: CLI (localwiki-agent) and direct API (Google/OpenAI/OpenRouter)."""
import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, AsyncGenerator

import google.generativeai as genai
from adalflow.core.types import ModelType
from fastapi import HTTPException

from api.config import OPENAI_API_KEY, OPENROUTER_API_KEY, get_model_config
from api.events import EventType
from api.openai_client import OpenAIClient
from api.openrouter_client import OpenRouterClient
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent.parent

_MAX_EMPTY_RETRIES = 2
_EMPTY_RETRY_DELAYS = [5, 15]  # seconds between retry attempts


# ── CLI (localwiki-agent) ───────────────────────────────────────────────────

def _get_agent_bin() -> Path:
    candidates = [
        _PROJECT_ROOT / "bin" / "localwiki-agent",
        _PROJECT_ROOT / "bin" / "agent" / "localwiki-agent",
        _PROJECT_ROOT / "localwiki-agent",
        Path("/tmp/localwiki-agent"),
    ]
    for path in candidates:
        if path.exists():
            return path
    raise HTTPException(
        status_code=500,
        detail="localwiki-agent 바이너리를 찾을 수 없습니다. agent/ 디렉토리에서 빌드하세요.",
    )


def _build_cli_env(request) -> dict:
    env = os.environ.copy()
    env.pop("GEMINI_API_KEY", None)
    env.pop("GOOGLE_API_KEY", None)
    env.pop("GOOGLE_CLOUD_PROJECT_ID", None)
    if request.api_key:
        if request.provider == "openai":
            env["OPENAI_API_KEY"] = request.api_key
        elif request.provider == "anthropic":
            env["ANTHROPIC_API_KEY"] = request.api_key
    return env


async def cli_stream(request, prompt: str) -> AsyncGenerator[str, None]:
    """Stream JSONL output from the localwiki-agent CLI binary."""
    agent = request.cli_tool or "codex"
    model_override = request.model or ""

    if agent == "gemini" or (model_override and model_override.startswith("agy-")):
        agent = "antigravity"
    if agent == "gemini" and model_override == "gemini-3.1-flash":
        model_override = "gemini-3.1-pro-preview"

    agent_bin = _get_agent_bin()
    env = _build_cli_env(request)

    # Per-line timeout — if agy hangs, Python kills the process after this many seconds
    CLI_LINE_TIMEOUT = 300

    got_empty = False

    for attempt in range(_MAX_EMPTY_RETRIES + 1):
        if attempt > 0:
            wait = _EMPTY_RETRY_DELAYS[attempt - 1]
            logger.warning(f"빈 응답 — {wait}초 후 재시도 ({attempt}/{_MAX_EMPTY_RETRIES}). agent={agent}")
            if request.stream_id:
                await emit_task_event(
                    request.stream_id, "agent_log",
                    f"빈 응답 — {wait}초 후 재시도 ({attempt}/{_MAX_EMPTY_RETRIES})…",
                    phase="generation",
                )
            await asyncio.sleep(wait)

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

        logger.info(
            f"CLI 모드 실행: {' '.join(cmd)} | "
            f"프롬프트 크기: {len(prompt)}자 ({len(prompt) // 4} 추정토큰) | "
            f"미리보기: {prompt[:200]!r}"
        )
        if attempt == 0:
            await emit_task_event(
                request.stream_id, "task_status",
                f"CLI 모드 ({agent}) 실행 중...",
                phase="generation",
            )

        got_empty = False
        done = False  # True when a non-retryable terminal state was already yielded

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            full_content: list[str] = []
            timed_out = False

            while True:
                try:
                    raw_line = await asyncio.wait_for(
                        proc.stdout.readline(), timeout=CLI_LINE_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    timed_out = True
                    logger.error(
                        f"CLI 응답 없음 — {CLI_LINE_TIMEOUT}초 초과, 프로세스 강제 종료. 프롬프트: {prompt_file}"
                    )
                    proc.kill()
                    try:
                        await asyncio.wait_for(proc.wait(), timeout=10)
                    except asyncio.TimeoutError:
                        pass
                    if request.stream_id:
                        await emit_task_event(
                            request.stream_id, "error",
                            f"CLI 응답 없음 — {CLI_LINE_TIMEOUT}초 초과로 프로세스 강제 종료",
                            phase="generation",
                        )
                    yield "CLI Error: timeout"
                    done = True
                    break

                if not raw_line:  # EOF
                    break

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
                        await emit_task_event(
                            request.stream_id, "error", f"CLI 실패: {err_msg}", phase="generation"
                        )
                elif etype == "chunk":
                    chunk_text = event.get("content", "")
                    full_content.append(chunk_text)
                    yield chunk_text
                    if request.stream_id:
                        await emit_task_event(
                            request.stream_id, EventType.AGENT_CHUNK, chunk_text, phase="generation"
                        )
                elif etype == "complete":
                    content = event.get("content", "")
                    if content and not full_content:
                        yield content
                elif etype == "status":
                    logger.info(f"CLI status: {event.get('content', '')}")

            if not timed_out:
                await proc.wait()
                stderr_out = await proc.stderr.read()
                err_str = stderr_out.decode().strip()

                if proc.returncode != 0 or (not full_content and err_str):
                    err_detail = err_str or f"(returncode={proc.returncode}, 출력 없음)"
                    logger.error(f"CLI 에이전트 종료 코드 {proc.returncode}: {err_detail}")
                    if request.stream_id:
                        await emit_task_event(
                            request.stream_id, "error",
                            f"CLI 실행 실패: {err_detail}", phase="generation",
                        )
                    yield f"CLI Error: {err_detail}"
                    done = True
                elif not full_content:
                    got_empty = True  # retryable: no chunks yielded yet, safe to retry
        finally:
            try:
                os.unlink(prompt_file)
            except Exception:
                pass

        if done or not got_empty:
            break

    if got_empty:
        logger.error(
            f"CLI 에이전트가 종료코드 0으로 종료됐지만 출력 없음 "
            f"(재시도 {_MAX_EMPTY_RETRIES}회 소진). agent={agent}"
        )
        if request.stream_id:
            await emit_task_event(
                request.stream_id, "error",
                "CLI가 빈 응답을 반환했습니다 (returncode=0, 출력 없음). agy 실행 환경을 확인하세요.",
                phase="generation",
            )
        yield "CLI Error: empty response (returncode=0)"


# ── Direct API (Google / OpenAI / OpenRouter) ───────────────────────────────

def create_api_model(request) -> tuple[Any, dict | None]:
    """Instantiate the LLM client. Returns (model, model_kwargs)."""
    model_config = get_model_config(request.provider, request.model)["model_kwargs"]

    if request.provider == "openrouter":
        logger.info(f"Using OpenRouter with model: {request.model}")
        if not OPENROUTER_API_KEY:
            logger.warning("OPENROUTER_API_KEY not configured")
        client = OpenRouterClient()
        kwargs = {"model": request.model, "stream": True, "temperature": model_config["temperature"]}
        if "top_p" in model_config:
            kwargs["top_p"] = model_config["top_p"]
        return client, kwargs

    if request.provider == "openai" or request.litellm_base_url:
        logger.info(f"Using OpenAI protocol with model: {request.model}")
        if request.litellm_base_url:
            logger.info(f"Routing to litellm proxy: {request.litellm_base_url}")
            client = OpenAIClient(api_key="local", base_url=request.litellm_base_url)
        else:
            effective_key = request.api_key or OPENAI_API_KEY
            if not effective_key:
                raise ValueError("OPENAI_API_KEY is not set.")
            client = OpenAIClient(api_key=effective_key)
        kwargs = {"model": request.model, "stream": True, "temperature": model_config.get("temperature", 0.7)}
        if "top_p" in model_config:
            kwargs["top_p"] = model_config["top_p"]
        return client, kwargs

    # Google (default)
    google_model = genai.GenerativeModel(
        model_name=model_config["model"],
        generation_config={
            "temperature": model_config["temperature"],
            "top_p": model_config["top_p"],
            "top_k": model_config["top_k"],
        },
    )
    return google_model, None


async def _dispatch_to_provider(
    model: Any,
    model_kwargs: dict | None,
    request,
    prompt: str,
) -> AsyncGenerator[str, None]:
    """Low-level provider call — yields raw text chunks."""
    if request.provider == "openrouter":
        api_kwargs = model.convert_inputs_to_api_kwargs(
            input=prompt, model_kwargs=model_kwargs, model_type=ModelType.LLM
        )
        try:
            logger.info("Making OpenRouter API call")
            response = await model.acall(api_kwargs=api_kwargs, model_type=ModelType.LLM)
            async for chunk in response:
                yield chunk
        except Exception as e:
            logger.error(f"Error with OpenRouter API: {str(e)}")
            yield (
                f"\nError with OpenRouter API: {str(e)}\n\n"
                "Please check that you have set the OPENROUTER_API_KEY environment variable."
            )

    elif request.provider == "openai" or request.litellm_base_url:
        api_kwargs = model.convert_inputs_to_api_kwargs(
            input=prompt, model_kwargs=model_kwargs, model_type=ModelType.LLM
        )
        try:
            logger.info("Making OpenAI API call")
            response = await model.acall(api_kwargs=api_kwargs, model_type=ModelType.LLM)
            async for chunk in response:
                choices = getattr(chunk, "choices", [])
                if choices:
                    delta = getattr(choices[0], "delta", None)
                    if delta is not None:
                        text = getattr(delta, "content", None)
                        if text is not None:
                            yield text
        except Exception as e:
            logger.error(f"Error with OpenAI API: {str(e)}")
            yield (
                f"\nError with OpenAI API: {str(e)}\n\n"
                "Please check that you have set the OPENAI_API_KEY environment variable."
            )

    else:
        # Google (default)
        response = model.generate_content(prompt, stream=True)
        for chunk in response:
            if hasattr(chunk, "text"):
                yield chunk.text


async def api_stream(
    model: Any,
    model_kwargs: dict | None,
    request,
    system_prompt: str,
    conversation_history: str,
    file_content: str,
    prompt: str,
    query: str,
) -> AsyncGenerator[str, None]:
    """Stream from direct API provider with AGENT_* instrumentation and token-overflow fallback."""
    from api.chat.prompt_builder import assemble_fallback_prompt

    try:
        await emit_task_event(
            request.stream_id, "phase_start",
            f"Calling provider {request.provider}",
            phase="provider",
            data={"provider": request.provider, "model": request.model},
        )
        await emit_task_event(
            request.stream_id, EventType.AGENT_REQUEST,
            f"Request to {request.provider}",
            phase="provider",
            data={
                "provider": request.provider,
                "model": request.model,
                "prompt_tokens": len(prompt) // 4,
                "prompt_preview": prompt[:200],
            },
        )

        start_ns = time.monotonic_ns()
        chunk_count = 0

        async for chunk in _dispatch_to_provider(model, model_kwargs, request, prompt):
            chunk_count += 1
            yield chunk

        duration_ms = (time.monotonic_ns() - start_ns) // 1_000_000
        await emit_task_event(
            request.stream_id, EventType.AGENT_RESPONSE,
            f"Response from {request.provider}",
            phase="provider",
            data={
                "provider": request.provider,
                "model": request.model,
                "duration_ms": duration_ms,
                "chunk_count": chunk_count,
            },
        )

    except Exception as e_outer:
        logger.error(f"Error in streaming response: {str(e_outer)}")
        await emit_task_event(
            request.stream_id, EventType.AGENT_ERROR,
            f"Error in streaming response: {str(e_outer)}",
            phase="provider",
        )
        error_message = str(e_outer)

        is_token_overflow = any(
            kw in error_message
            for kw in ("maximum context length", "token limit", "too many tokens")
        )

        if is_token_overflow:
            logger.warning("Token limit exceeded, retrying without context")
            simplified = assemble_fallback_prompt(
                request, system_prompt, conversation_history, file_content, query
            )
            try:
                async for chunk in _dispatch_to_provider(model, model_kwargs, request, simplified):
                    yield chunk if isinstance(chunk, str) else getattr(chunk, "text", str(chunk))
            except Exception as e2:
                logger.error(f"Error in fallback streaming response: {str(e2)}")
                yield "\nI apologize, but your request is too large to process. Please try a shorter query."
        else:
            yield f"\nError: {error_message}"

    finally:
        await emit_task_event(
            request.stream_id, "complete",
            "Chat completion stream finished",
            phase="chat",
            data={"provider": request.provider, "model": request.model},
        )
