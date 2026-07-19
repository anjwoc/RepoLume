from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import tempfile
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from api.background_jobs import background_jobs
from api.chat import provider_dispatcher
from api.chat.models import ChatCompletionRequest, ChatMessage
from api.db.generation_jobs import TaskDefinition, generation_job_store
from api.db.store import job_store
from api.events import EventType
from api.task_streams import emit_task_event


class ScenarioPrompt(BaseModel):
    flow_id: str
    flow_name: str
    output_file: str
    prompt: str = Field(min_length=1)
    kind: str = "flow"


class TestScenarioJobRequest(BaseModel):
    __test__ = False
    stream_id: str = Field(min_length=1)
    source_path: str = Field(min_length=1)
    artifact_root: str = Field(min_length=1)
    provider: str = "google"
    model: str | None = None
    use_cli: bool = True
    cli_tool: str | None = None
    api_key: str | None = None
    language: str = "ko"
    items: list[ScenarioPrompt] = Field(min_length=1)


class TestScenarioBatchError(RuntimeError):
    __test__ = False
    pass


GenerateText = Callable[[str, ScenarioPrompt], Awaitable[str]]
EmitProgress = Callable[[str, str, dict[str, Any]], Awaitable[None]]


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        delete=False,
    ) as handle:
        handle.write(content)
        temporary_path = handle.name
    os.replace(temporary_path, path)


def _safe_output_path(output_root: Path, output_file: str) -> Path:
    candidate = Path(output_file)
    if candidate.name != output_file or candidate.suffix.lower() != ".md":
        raise ValueError(f"Invalid output filename: {output_file}")
    resolved = (output_root / candidate.name).resolve()
    if resolved.parent != output_root.resolve():
        raise ValueError(f"Output escapes artifact directory: {output_file}")
    return resolved


def _validate_generated_markdown(markdown: str) -> tuple[bool, str | None]:
    stripped = markdown.strip()
    if not stripped:
        return False, "empty_response"
    if len(stripped) < 80:
        return False, "incomplete_response"
    heading_matches = [
        match.group(1).strip().lower()
        for line in stripped.splitlines()
        if (match := re.match(r"^#{1,3}\s+(.+?)\s*$", line))
    ]
    has_h1 = any(re.match(r"^#\s+", line) for line in stripped.splitlines())
    required_heading_terms = [
        ("happy path", "정상 경로", "정상 흐름"),
        ("data integrity", "데이터 무결성", "무결성"),
        ("error recovery", "오류 복구", "에러 복구", "장애 복구"),
    ]
    if not has_h1 or any(
        not any(term in heading for heading in heading_matches for term in terms)
        for terms in required_heading_terms
    ):
        return False, "missing_required_sections"
    if "file://" in stripped:
        return False, "external_artifact_reference"
    return True, None


async def _noop_progress(_phase: str, _message: str, _data: dict[str, Any]) -> None:
    return None


async def generate_test_scenario_artifacts(
    request: TestScenarioJobRequest,
    generate_text: GenerateText,
    emit_progress: EmitProgress = _noop_progress,
) -> list[dict[str, Any]]:
    source_path = Path(request.source_path).expanduser().resolve()
    artifact_root = Path(request.artifact_root).expanduser().resolve()
    if not source_path.is_dir():
        raise TestScenarioBatchError(f"Source path is not a directory: {source_path}")
    if source_path == artifact_root:
        raise TestScenarioBatchError("Source path and artifact root must be different")

    output_root = artifact_root / "test-scenarios"
    output_root.mkdir(parents=True, exist_ok=True)
    started_at = _utc_now()
    results: list[dict[str, Any]] = []

    def write_manifest(status: str) -> None:
        succeeded = sum(item["status"] == "succeeded" for item in results)
        failed = sum(item["status"] == "failed" for item in results)
        manifest = {
            "version": 1,
            "job_id": request.stream_id,
            "status": status,
            "source_path": str(source_path),
            "artifact_root": str(artifact_root),
            "expected": len(request.items),
            "succeeded": succeeded,
            "failed": failed,
            "started_at": started_at,
            "completed_at": _utc_now() if status in {"completed", "failed"} else None,
            "results": results,
        }
        _atomic_write(output_root / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    write_manifest("running")
    await emit_progress("parsing", "테스트 시나리오 입력 검증 완료", {"percent": 10})

    for index, item in enumerate(request.items):
        result: dict[str, Any] = {
            "flow_id": item.flow_id,
            "flow_name": item.flow_name,
            "kind": item.kind,
            "output_file": item.output_file,
            "status": "running",
            "started_at": _utc_now(),
        }
        results.append(result)
        percent = 15 + round((index / len(request.items)) * 70)
        await emit_progress(
            "generating",
            f"{item.flow_id} 테스트 시나리오 생성 중",
            {"percent": percent, "flow_id": item.flow_id},
        )
        try:
            output_path = _safe_output_path(output_root, item.output_file)
            markdown = await generate_text(item.prompt, item)
            valid, error_code = _validate_generated_markdown(markdown)
            if not valid:
                raise TestScenarioBatchError(error_code or "invalid_response")
            normalized = markdown.strip() + "\n"
            await asyncio.to_thread(_atomic_write, output_path, normalized)
            result.update(
                {
                    "status": "succeeded",
                    "completed_at": _utc_now(),
                    "bytes": len(normalized.encode("utf-8")),
                    "sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
                }
            )
        except Exception as error:
            error_code = str(error) if isinstance(error, TestScenarioBatchError) else "generation_failed"
            result.update(
                {
                    "status": "failed",
                    "completed_at": _utc_now(),
                    "error_code": error_code,
                    "error_message": str(error),
                }
            )
        write_manifest("running")

    succeeded = [item for item in results if item["status"] == "succeeded"]
    failed = [item for item in results if item["status"] == "failed"]
    index_lines = [
        "# Test Scenarios",
        "",
        f"Generated: {len(succeeded)} / {len(request.items)}",
        "",
        "| Flow | Scenario | Status |",
        "|---|---|---|",
    ]
    for result in results:
        link = f"[{result['flow_name']}]({result['output_file']})"
        status_label = "PASS" if result["status"] == "succeeded" else "FAIL"
        index_lines.append(f"| {result['flow_id']} | {link} | {status_label} |")
    await asyncio.to_thread(_atomic_write, output_root / "_index.md", "\n".join(index_lines) + "\n")

    if failed or len(succeeded) != len(request.items):
        write_manifest("failed")
        failed_ids = ", ".join(item["flow_id"] for item in failed)
        raise TestScenarioBatchError(
            f"Scenario completeness barrier failed: {len(succeeded)}/{len(request.items)}; failed={failed_ids}"
        )

    write_manifest("completed")
    await emit_progress("writing-output", "테스트 시나리오 산출물 저장 완료", {"percent": 100})
    return results


async def _collect_provider_text(
    request: TestScenarioJobRequest,
    item: ScenarioPrompt,
    prompt: str,
    attempt_id: str,
) -> str:
    provider_prompt = (
        f"{prompt}\n\n"
        "OUTPUT CONTRACT:\n"
        "Return the complete test guide as Markdown in this response.\n"
        "Do not create or reference another file, artifact, attachment, or file:// URL.\n"
        "The response must contain an H1 title and real H2 headings for Happy Path, "
        "Data Integrity, and Error Recovery. Do not wrap the Markdown in a code fence."
    )
    chat_request = ChatCompletionRequest(
        repo_url=request.source_path,
        messages=[ChatMessage(role="user", content=provider_prompt)],
        provider=request.provider,
        model=request.model,
        language=request.language,
        stream_id=request.stream_id,
        skip_rag=True,
        api_key=request.api_key,
        use_cli=request.use_cli,
        cli_tool=request.cli_tool,
        task_id=item.flow_id,
    )
    if request.use_cli:
        stream = provider_dispatcher.cli_stream(chat_request, provider_prompt, raise_on_error=True)
    else:
        model, model_kwargs = provider_dispatcher.create_api_model(chat_request)
        stream = provider_dispatcher.api_stream(
            model,
            model_kwargs,
            chat_request,
            "",
            "",
            "",
            provider_prompt,
            provider_prompt,
            raise_on_error=True,
        )

    chunks: list[str] = []
    iterator = stream.__aiter__()
    overall_deadline = time.monotonic() + 1200
    while True:
        remaining = overall_deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Provider overall timeout")
        try:
            chunk = await asyncio.wait_for(iterator.__anext__(), timeout=min(330, remaining))
        except StopAsyncIteration:
            break
        except asyncio.TimeoutError as error:
            raise TimeoutError("Provider idle timeout") from error
        if chunk:
            chunks.append(str(chunk))
            await asyncio.to_thread(generation_job_store.record_activity, attempt_id)
    return "".join(chunks)


async def run_test_scenario_job(request: TestScenarioJobRequest) -> None:
    started = time.monotonic()
    attempt = await asyncio.to_thread(
        generation_job_store.begin_attempt,
        request.stream_id,
        "test-scenarios",
    )

    async def progress(phase: str, message: str, data: dict[str, Any]) -> None:
        await asyncio.to_thread(generation_job_store.record_activity, attempt.attempt_id, heartbeat=True)
        await emit_task_event(request.stream_id, "phase_start", message, phase=phase, data=data)

    async def generate(prompt: str, item: ScenarioPrompt) -> str:
        return await _collect_provider_text(request, item, prompt, attempt.attempt_id)

    try:
        results = await generate_test_scenario_artifacts(request, generate, progress)
        completed = await asyncio.to_thread(
            generation_job_store.complete_attempt,
            attempt.attempt_id,
            {"result_count": len(results)},
        )
        completeness = await asyncio.to_thread(generation_job_store.completeness, request.stream_id)
        if not completed or not completeness["complete"] or completeness["succeeded"] != completeness["expected"]:
            raise TestScenarioBatchError(f"Job completeness barrier failed: {completeness}")
    except asyncio.CancelledError:
        await asyncio.to_thread(
            generation_job_store.fail_attempt,
            attempt.attempt_id,
            error_code="cancelled",
            error_message="Test scenario generation cancelled",
            failure_status="cancelled",
            retryable=False,
        )
        await asyncio.to_thread(job_store.interrupt, request.stream_id, "cancelled")
        await emit_task_event(request.stream_id, "cancelled", "테스트 시나리오 생성 취소", phase="generation")
        raise
    except Exception as error:
        await asyncio.to_thread(
            generation_job_store.fail_attempt,
            attempt.attempt_id,
            error_code="scenario_generation_failed",
            error_message=str(error),
            retryable=False,
        )
        await asyncio.to_thread(job_store.fail, request.stream_id, str(error))
        await emit_task_event(request.stream_id, EventType.ERROR, str(error), phase="generation")
    else:
        duration_ms = int((time.monotonic() - started) * 1000)
        await asyncio.to_thread(job_store.complete, request.stream_id, duration_ms)
        await emit_task_event(
            request.stream_id,
            EventType.COMPLETE,
            "테스트 시나리오 생성 완료",
            phase="writing-output",
            data={
                "artifact_root": request.artifact_root,
                "manifest": str(Path(request.artifact_root) / "test-scenarios" / "manifest.json"),
                "result_count": len(results),
            },
        )


async def queue_test_scenario_job(
    request: TestScenarioJobRequest,
    existing_job: bool = False,
) -> None:
    if not existing_job:
        await asyncio.to_thread(job_store.create, request.stream_id)
    await asyncio.to_thread(job_store.start, request.stream_id)
    resumable = request.model_dump(exclude={"api_key"})
    await asyncio.to_thread(
        generation_job_store.register_tasks,
        request.stream_id,
        [
            TaskDefinition(
                "test-scenarios",
                "test_scenarios",
                {"request": resumable},
                restart_safe=not bool(request.api_key),
                max_attempts=3,
            )
        ],
    )
    await background_jobs.start(request.stream_id, run_test_scenario_job(request))


async def resume_requeued_test_scenario_job(reconciled: dict[str, Any]) -> bool:
    try:
        payload = json.loads(reconciled.get("payload_json") or "{}")
        request = TestScenarioJobRequest.model_validate(payload["request"])
        await queue_test_scenario_job(request, existing_job=True)
        await emit_task_event(
            request.stream_id,
            "task_status",
            "테스트 시나리오 작업을 서비스 재시작 후 복구했습니다",
            phase="recovery",
        )
        return True
    except Exception as error:
        await asyncio.to_thread(
            generation_job_store.fail_queued_task,
            str(reconciled["job_id"]),
            str(reconciled["task_id"]),
            error_code="restart_recovery_failed",
            error_message=str(error),
        )
        await asyncio.to_thread(job_store.fail, str(reconciled["job_id"]), str(error))
        await emit_task_event(str(reconciled["job_id"]), EventType.ERROR, str(error), phase="recovery")
        return False
