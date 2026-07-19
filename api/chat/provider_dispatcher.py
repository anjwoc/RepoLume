"""LLM provider dispatch: CLI (localwiki-agent) and direct API (Google/OpenAI/OpenRouter)."""
import asyncio
from contextlib import suppress
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, AsyncGenerator

import google.generativeai as genai
from adalflow.core.types import ModelType
from fastapi import HTTPException

from api.config import OPENAI_API_KEY, OPENROUTER_API_KEY, get_model_config
from api.db.generation_jobs import generation_job_store
from api.events import EventType
from api.openai_client import OpenAIClient
from api.openrouter_client import OpenRouterClient
from api.provider_lanes import get_provider_lane_scheduler
from api.process_supervisor import (
    ProcessIdleTimeout,
    ProcessOverallTimeout,
    SupervisedProcess,
    get_process_fingerprint,
)
from api.task_streams import emit_task_event

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent.parent

_MAX_EMPTY_RETRIES = 2
_EMPTY_RETRY_DELAYS = [5, 15]  # seconds between retry attempts
_CLI_IDLE_TIMEOUT_SECONDS = float(os.getenv("LOCALWIKI_CLI_IDLE_TIMEOUT_SECONDS", "300"))
_CLI_OVERALL_TIMEOUT_SECONDS = float(os.getenv("LOCALWIKI_CLI_OVERALL_TIMEOUT_SECONDS", "1200"))
_CLI_HEARTBEAT_SECONDS = float(os.getenv("LOCALWIKI_CLI_HEARTBEAT_SECONDS", "15"))
_CLI_PIPE_LIMIT = 100 * 1024 * 1024

# agy (antigravity) silently exits(0) with no output when prompt exceeds this.
# Empirical: 2500 tokens works, 5000 tokens times out. 3000 is the safe ceiling.
_AGY_TOKEN_HARD_LIMIT = 12000

_AGY_CLI_LOG = Path.home() / ".gemini" / "antigravity-cli" / "cli.log"


def _agy_log_offset() -> int:
    try:
        return _AGY_CLI_LOG.stat().st_size
    except OSError:
        return 0


def _check_agy_quota_error(since_offset: int = 0) -> str | None:
    """Read the last 4KB of the agy CLI log and return a quota error message if found."""
    try:
        if not _AGY_CLI_LOG.exists():
            return None
        with open(_AGY_CLI_LOG, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            start = since_offset if 0 <= since_offset <= size else 0
            f.seek(max(start, size - 4096))
            tail = f.read().decode("utf-8", errors="ignore")
        import re
        m = re.search(r"RESOURCE_EXHAUSTED.*?Resets in ([^\.:]+)", tail)
        if m:
            return f"agy 쿼터 소진 (429). 리셋까지: {m.group(1)}. 잠시 후 다시 시도하세요."
    except Exception:
        pass
    return None

# Pass-2 headroom: first_response + instruction wrapper take roughly this many tokens.
_AGY_PASS2_OVERHEAD = 700

# XML blocks to split across passes, in eviction priority order (least important first).
_AGY_TRIM_TAGS = [
    "file_sample", "file_tree", "architecture_graph", "directory_map", "readme",
]


def _split_prompt_for_agy(prompt: str) -> tuple[str, str | None]:
    """
    Split an oversized prompt into (first_pass, overflow).

    Strategy: for each large XML block (least-important first), keep the first
    half in the prompt and stash the second half as overflow. Stop as soon as the
    first pass fits under _AGY_TOKEN_HARD_LIMIT.  Overflow is None when everything
    fits in one pass.

    Caller responsibility: if overflow is not None, issue a second agy call with
        "Previous response: [first_result]\n\nAdditional context:\n[overflow]"
    and return the refined response.
    """
    import re

    estimated = len(prompt) // 4
    if estimated <= _AGY_TOKEN_HARD_LIMIT:
        return prompt, None

    overflow_parts: list[str] = []
    working = prompt

    for tag in reversed(_AGY_TRIM_TAGS):  # evict least-important first
        pattern = re.compile(
            rf"(<{tag}[^>]*>)(.*?)(</{tag}>)",
            re.DOTALL | re.IGNORECASE,
        )
        m = pattern.search(working)
        if not m:
            continue

        open_tag, body, close_tag = m.group(1), m.group(2), m.group(3)
        lines = body.splitlines()
        if len(lines) < 10:
            continue  # too small to split usefully

        split = len(lines) // 2
        first_half = "\n".join(lines[:split])
        second_half = "\n".join(lines[split:])

        if second_half.strip():
            overflow_parts.append(f"{open_tag}\n{second_half}\n{close_tag}")

        stub = first_half + "\n... (continued in follow-up pass)"
        working = pattern.sub(open_tag + stub + close_tag, working, count=1)

        if len(working) // 4 <= _AGY_TOKEN_HARD_LIMIT:
            break

    overflow = "\n\n".join(overflow_parts) if overflow_parts else None
    if overflow:
        logger.info(
            f"[agy] Prompt split: pass-1 ~{len(working)//4} tokens, "
            f"overflow ~{len(overflow)//4} tokens (was {estimated} total)"
        )
    return working, overflow


def _build_pass2_prompt(original_prompt: str, first_response: str, overflow: str) -> str:
    """Wrap first_response + overflow into a refinement prompt for pass 2."""
    return (
        f"{original_prompt}\n\n"
        f"---\n"
        f"I generated an initial draft but had additional context that didn't fit.\n"
        f"Here is the initial draft:\n\n{first_response}\n\n"
        f"Please enhance and extend the draft using this supplementary context "
        f"(add details, fix gaps, don't remove anything already correct):\n\n"
        f"{overflow}"
    )


# ── AGY account rotation (quota exhaustion recovery) ─────────────────────────

_AGY_ACCOUNTS_DIR = Path.home() / ".localwiki" / "agy-accounts"
_AGY_TOKEN_PATH = Path.home() / ".gemini" / "antigravity-cli" / "antigravity-oauth-token"
_agy_account_index = 0
_agy_rotation_lock: asyncio.Lock | None = None


def _get_agy_accounts() -> list[Path]:
    if not _AGY_ACCOUNTS_DIR.exists():
        return []
    return sorted(_AGY_ACCOUNTS_DIR.glob("*.json"))


def _get_agy_rotation_lock() -> asyncio.Lock:
    global _agy_rotation_lock
    if _agy_rotation_lock is None:
        _agy_rotation_lock = asyncio.Lock()
    return _agy_rotation_lock


def _replace_agy_token(source: Path) -> None:
    _AGY_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = _AGY_TOKEN_PATH.with_name(f".{_AGY_TOKEN_PATH.name}.{os.getpid()}.tmp")
    try:
        shutil.copy2(source, temporary)
        os.chmod(temporary, 0o600)
        os.replace(temporary, _AGY_TOKEN_PATH)
    finally:
        temporary.unlink(missing_ok=True)


async def _rotate_agy_account() -> bool:
    global _agy_account_index
    async with _get_agy_rotation_lock():
        accounts = _get_agy_accounts()
        if not accounts:
            return False
        next_index = (_agy_account_index + 1) % len(accounts)
        try:
            await asyncio.to_thread(_replace_agy_token, accounts[next_index])
            _agy_account_index = next_index
            logger.info("[agy] 계정 전환 → slot-%s", next_index + 1)
            return True
        except Exception as error:
            logger.error("[agy] 계정 전환 실패: %s", error)
            return False


def _get_agent_bin() -> Path:
    configured = os.getenv("LOCALWIKI_AGENT_BIN")
    candidates = [
        Path(configured) if configured else None,
        _PROJECT_ROOT / "bin" / "localwiki-agent",
        _PROJECT_ROOT / "bin" / "agent" / "localwiki-agent",
        _PROJECT_ROOT / "localwiki-agent",
        Path("/tmp/localwiki-agent"),
    ]
    for path in candidates:
        if path is not None and path.exists():
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


class CliExecutionError(RuntimeError):
    pass


async def _emit_cli_heartbeats(
    stream_id: str | None,
    attempt_id: str | None,
    task_id: str | None,
    agent: str,
) -> None:
    while True:
        await asyncio.sleep(_CLI_HEARTBEAT_SECONDS)
        if attempt_id:
            active = await asyncio.to_thread(
                generation_job_store.record_activity,
                attempt_id,
                heartbeat=True,
            )
            if not active:
                return
        await emit_task_event(
            stream_id,
            EventType.HEARTBEAT,
            "CLI process is active",
            phase="generation",
            data={
                "attempt_id": attempt_id,
                "task_id": task_id,
                "agent": agent,
            },
        )


async def cli_stream(
    request,
    prompt: str,
    *,
    generation_job_id: str | None = None,
    generation_task_id: str | None = None,
    raise_on_error: bool = False,
) -> AsyncGenerator[str, None]:
    """Stream JSONL output from the localwiki-agent CLI binary."""
    agent = request.cli_tool or "codex"
    model_override = request.model or ""

    if agent == "gemini" or (model_override and model_override.startswith("agy-")):
        agent = "antigravity"
    if agent == "gemini" and model_override == "gemini-3.1-flash":
        model_override = "gemini-3.1-pro-preview"

    agent_bin = _get_agent_bin()
    env = _build_cli_env(request)

    # Split prompt for multi-pass if agy limit would be exceeded
    if agent == "antigravity":
        effective_prompt, _agy_overflow = _split_prompt_for_agy(prompt)
    else:
        effective_prompt, _agy_overflow = prompt, None
    _first_response_parts: list[str] = []

    got_empty = False
    final_error: str | None = None
    final_quota_error: str | None = None
    agy_rotation_count = 0

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
            pf.write(effective_prompt)
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
        agy_log_offset = _agy_log_offset() if agent == "antigravity" else 0
        ledger_attempt = None
        if generation_job_id and generation_task_id:
            ledger_attempt = await asyncio.to_thread(
                generation_job_store.begin_attempt,
                generation_job_id,
                generation_task_id,
            )

        full_content: list[str] = []
        attempt_error: str | None = None
        error_code = "cli_error"
        failure_status = "failed"
        retryable = False
        heartbeat_task = None
        async def lane_heartbeat(stage: str, waited_seconds: float) -> None:
            if ledger_attempt:
                await asyncio.to_thread(
                    generation_job_store.record_activity,
                    ledger_attempt.attempt_id,
                    heartbeat=True,
                )
            await emit_task_event(
                request.stream_id,
                EventType.HEARTBEAT,
                "Waiting for provider capacity",
                phase="generation",
                data={
                    "agent": agent,
                    "stage": stage,
                    "waited_seconds": round(waited_seconds, 3),
                    "task_id": generation_task_id,
                },
            )

        lane_lease = await get_provider_lane_scheduler().acquire(
            agent,
            lane_heartbeat,
        )
        try:
            proc = await SupervisedProcess.start(
                cmd,
                env=env,
                idle_timeout=_CLI_IDLE_TIMEOUT_SECONDS,
                overall_timeout=_CLI_OVERALL_TIMEOUT_SECONDS,
                stream_limit=_CLI_PIPE_LIMIT,
            )
            if ledger_attempt:
                process_fingerprint = await asyncio.to_thread(
                    get_process_fingerprint,
                    proc.pid,
                )
                await asyncio.to_thread(
                    generation_job_store.attach_process,
                    ledger_attempt.attempt_id,
                    pid=proc.pid,
                    process_group_id=proc.process_group_id,
                    process_fingerprint=process_fingerprint,
                )
            heartbeat_task = asyncio.create_task(
                _emit_cli_heartbeats(
                    request.stream_id,
                    ledger_attempt.attempt_id if ledger_attempt else None,
                    generation_task_id,
                    agent,
                )
            )

            async for output in proc.iter_output():
                if ledger_attempt:
                    await asyncio.to_thread(
                        generation_job_store.record_activity,
                        ledger_attempt.attempt_id,
                    )
                if output.stream == "stderr":
                    continue
                line = output.data.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    full_content.append(line)
                    yield line
                    continue

                etype = event.get("type", "")
                if "error" in event and event["error"]:
                    attempt_error = str(event["error"])
                    error_code = "agent_error"
                elif etype == "chunk":
                    chunk_text = event.get("content", "")
                    if chunk_text:
                        full_content.append(chunk_text)
                        yield chunk_text
                        if request.stream_id:
                            await emit_task_event(
                                request.stream_id,
                                EventType.AGENT_CHUNK,
                                chunk_text,
                                phase="generation",
                                data={"attempt_id": ledger_attempt.attempt_id}
                                if ledger_attempt
                                else None,
                            )
                elif etype == "complete":
                    content = event.get("content", "")
                    if content and not full_content:
                        full_content.append(content)
                        yield content
                elif etype == "status":
                    logger.info(f"CLI status: {event.get('content', '')}")

            err_str = proc.stderr_text.strip()
            if attempt_error:
                done = True
            elif proc.returncode != 0:
                attempt_error = err_str or f"CLI exited with code {proc.returncode}"
                error_code = "nonzero_exit"
                done = True
            elif not full_content:
                attempt_error = err_str or "CLI returned an empty response"
                error_code = "empty_response"
                retryable = True
                got_empty = True
        except ProcessIdleTimeout as exc:
            attempt_error = str(exc)
            error_code = "idle_timeout"
            failure_status = "timed_out"
            retryable = not full_content
            got_empty = not full_content
            done = bool(full_content)
        except ProcessOverallTimeout as exc:
            attempt_error = str(exc)
            error_code = "overall_timeout"
            failure_status = "timed_out"
            retryable = not full_content
            got_empty = not full_content
            done = bool(full_content)
        except asyncio.CancelledError:
            if ledger_attempt:
                await asyncio.to_thread(
                    generation_job_store.fail_attempt,
                    ledger_attempt.attempt_id,
                    error_code="cancelled",
                    error_message="CLI execution cancelled",
                    failure_status="cancelled",
                    retryable=False,
                )
            raise
        except Exception as exc:
            attempt_error = str(exc)
            error_code = "spawn_error"
            done = True
        finally:
            if heartbeat_task:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task
            await lane_lease.release()
            try:
                os.unlink(prompt_file)
            except Exception:
                pass

        if attempt_error and agent == "antigravity":
            quota_error = _check_agy_quota_error(agy_log_offset)
            if quota_error:
                final_quota_error = quota_error
                attempt_error = quota_error
                error_code = "quota_exhausted"
                failure_status = "failed"
                can_rotate = (
                    attempt < _MAX_EMPTY_RETRIES
                    and not full_content
                    and agy_rotation_count < len(_get_agy_accounts())
                    and await _rotate_agy_account()
                )
                retryable = can_rotate
                got_empty = can_rotate
                done = not can_rotate
                if can_rotate:
                    agy_rotation_count += 1
                    logger.info("[agy] 계정 전환 후 다음 attempt에서 재시도")
                    if request.stream_id:
                        await emit_task_event(
                            request.stream_id,
                            "agent_log",
                            "agy 쿼터 소진 → 다음 계정으로 전환 후 재시도 중...",
                            phase="generation",
                        )

        if attempt_error:
            logger.error(
                "CLI attempt failed: agent=%s attempt=%s code=%s error=%s",
                agent,
                attempt + 1,
                error_code,
                attempt_error,
            )
            if ledger_attempt:
                await asyncio.to_thread(
                    generation_job_store.fail_attempt,
                    ledger_attempt.attempt_id,
                    error_code=error_code,
                    error_message=attempt_error,
                    failure_status=failure_status,
                    retryable=retryable,
                    max_attempts=_MAX_EMPTY_RETRIES + 1,
                )
            final_error = attempt_error
        else:
            if ledger_attempt:
                completed = await asyncio.to_thread(
                    generation_job_store.complete_attempt,
                    ledger_attempt.attempt_id,
                    {"content_length": sum(len(part) for part in full_content)},
                )
                if not completed:
                    raise CliExecutionError(
                        f"Completion rejected for inactive attempt {ledger_attempt.attempt_id}"
                    )
            _first_response_parts = full_content[:]
            final_error = None
        if done or not got_empty:
            break

    if final_error:
        user_msg = final_quota_error or final_error
        logger.error(
            "CLI execution failed after retries. agent=%s error=%s",
            agent,
            user_msg,
        )
        if request.stream_id:
            await emit_task_event(
                request.stream_id, "error",
                user_msg,
                phase="generation",
            )
        if raise_on_error:
            raise CliExecutionError(user_msg)
        yield f"CLI Error: {user_msg}"
        return

    # ── 2nd pass: feed overflow context back for refinement ─────────────────
    if _agy_overflow and _first_response_parts:
        first_response_text = "".join(_first_response_parts)
        pass2_prompt = _build_pass2_prompt(effective_prompt, first_response_text, _agy_overflow)
        pass2_estimated = len(pass2_prompt) // 4
        logger.info(f"[agy] 2nd pass — overflow {len(_agy_overflow)//4} tokens, "
                    f"pass2 total ~{pass2_estimated} tokens")

        # Skip 2nd pass if it would exceed agy's capacity — the 1st pass result is
        # already streamed and complete; a truncated 2nd pass would corrupt it.
        if pass2_estimated > _AGY_TOKEN_HARD_LIMIT:
            logger.warning(
                f"[agy] 2nd pass skipped — ~{pass2_estimated} tokens exceeds limit "
                f"{_AGY_TOKEN_HARD_LIMIT}. 1st pass result preserved."
            )
            if request.stream_id:
                await emit_task_event(
                    request.stream_id, "agent_log",
                    f"⚠️ 2차 패스 생략 (~{pass2_estimated}토큰 > 한도 {_AGY_TOKEN_HARD_LIMIT}토큰). 1차 결과 유지.",
                    phase="generation",
                )
            return

        if request.stream_id:
            await emit_task_event(
                request.stream_id, "agent_log",
                f"⚗️ 추가 컨텍스트 2차 패스 실행 중... (~{pass2_estimated} 토큰)",
                phase="generation",
            )

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as pf2:
            pf2.write(pass2_prompt)
            pass2_file = pf2.name

        cmd2 = [
            str(agent_bin), "run",
            "--agent", agent,
            "--prompt-file", pass2_file,
            "--cwd", request.repo_url if os.path.isdir(request.repo_url) else ".",
            "--stream-jsonl",
            "--timeout", "1200",
        ]
        if model_override:
            cmd2 += ["--model", model_override]

        async def pass2_lane_heartbeat(stage: str, waited_seconds: float) -> None:
            await emit_task_event(
                request.stream_id,
                EventType.HEARTBEAT,
                "Waiting for provider capacity",
                phase="generation",
                data={
                    "agent": agent,
                    "stage": stage,
                    "waited_seconds": round(waited_seconds, 3),
                },
            )

        pass2_lease = await get_provider_lane_scheduler().acquire(
            agent,
            pass2_lane_heartbeat,
        )
        try:
            proc2 = await SupervisedProcess.start(
                cmd2,
                env=env,
                idle_timeout=_CLI_IDLE_TIMEOUT_SECONDS,
                overall_timeout=_CLI_OVERALL_TIMEOUT_SECONDS,
                stream_limit=_CLI_PIPE_LIMIT,
            )
            pass2_chunks: list[str] = []
            async for output in proc2.iter_output():
                if output.stream == "stderr":
                    continue
                line = output.data.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    yield line
                    continue
                etype = event.get("type", "")
                if etype == "chunk":
                    chunk_text = event.get("content", "")
                    if chunk_text:
                        pass2_chunks.append(chunk_text)
                        yield chunk_text
                        if request.stream_id:
                            await emit_task_event(
                                request.stream_id, EventType.AGENT_CHUNK, chunk_text, phase="generation"
                            )
                elif etype == "complete":
                    content = event.get("content", "")
                    if content and not pass2_chunks:
                        yield content
            if proc2.returncode != 0:
                logger.warning(
                    "[agy] 2nd pass failed with code %s: %s",
                    proc2.returncode,
                    proc2.stderr_text.strip(),
                )
        except (ProcessIdleTimeout, ProcessOverallTimeout) as exc:
            logger.warning("[agy] 2nd pass timed out: %s", exc)
        finally:
            await pass2_lease.release()
            try:
                os.unlink(pass2_file)
            except Exception:
                pass


# ── Direct API (Google / OpenAI / OpenRouter) ───────────────────────────────

def create_api_model(request) -> tuple[Any, dict | None]:
    """Instantiate the LLM client. Returns (model, model_kwargs)."""
    model_config = get_model_config(request.provider, request.model)["model_kwargs"]

    if request.provider == "openrouter":
        logger.info(f"Using OpenRouter with model: {request.model}")
        effective_key = request.api_key or OPENROUTER_API_KEY
        if not effective_key:
            raise ValueError("OPENROUTER_API_KEY is not set.")
        client = OpenRouterClient(api_key=effective_key)
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
        logger.info("Making OpenRouter API call")
        response = await model.acall(api_kwargs=api_kwargs, model_type=ModelType.LLM)
        async for chunk in response:
            yield chunk

    elif request.provider == "openai" or request.litellm_base_url:
        api_kwargs = model.convert_inputs_to_api_kwargs(
            input=prompt, model_kwargs=model_kwargs, model_type=ModelType.LLM
        )
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
    *,
    raise_on_error: bool = False,
) -> AsyncGenerator[str, None]:
    """Stream from direct API provider with AGENT_* instrumentation and token-overflow fallback."""
    from api.chat.prompt_builder import assemble_fallback_prompt

    completed = False
    chunk_count = 0

    async def lane_heartbeat(stage: str, waited_seconds: float) -> None:
        await emit_task_event(
            request.stream_id,
            EventType.HEARTBEAT,
            "Waiting for provider capacity",
            phase="provider",
            data={
                "provider": request.provider,
                "stage": stage,
                "waited_seconds": round(waited_seconds, 3),
            },
        )

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
        lane_lease = await get_provider_lane_scheduler().acquire(
            request.provider,
            lane_heartbeat,
        )
        try:
            async for chunk in _dispatch_to_provider(model, model_kwargs, request, prompt):
                chunk_count += 1
                yield chunk
        finally:
            await lane_lease.release()
        if chunk_count == 0:
            raise RuntimeError(f"{request.provider} returned an empty response")

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
        completed = True

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

        if is_token_overflow and chunk_count == 0:
            logger.warning("Token limit exceeded, retrying without context")
            simplified = assemble_fallback_prompt(
                request, system_prompt, conversation_history, file_content, query
            )
            try:
                fallback_chunk_count = 0
                fallback_lease = await get_provider_lane_scheduler().acquire(
                    request.provider,
                    lane_heartbeat,
                )
                try:
                    async for chunk in _dispatch_to_provider(
                        model,
                        model_kwargs,
                        request,
                        simplified,
                    ):
                        fallback_chunk_count += 1
                        yield (
                            chunk
                            if isinstance(chunk, str)
                            else getattr(chunk, "text", str(chunk))
                        )
                finally:
                    await fallback_lease.release()
                if fallback_chunk_count == 0:
                    raise RuntimeError(f"{request.provider} fallback returned an empty response")
                completed = True
            except Exception as e2:
                logger.error(f"Error in fallback streaming response: {str(e2)}")
                if raise_on_error:
                    raise
                yield f"\nError: {str(e2)}"
        else:
            if raise_on_error:
                raise
            yield f"\nError: {error_message}"

    finally:
        if completed:
            await emit_task_event(
                request.stream_id, "complete",
                "Chat completion stream finished",
                phase="chat",
                data={"provider": request.provider, "model": request.model},
            )
