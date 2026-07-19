from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

from api.routes.test_scenarios import create_test_scenario_job
from api.test_scenarios import (
    ScenarioPrompt,
    TestScenarioBatchError,
    TestScenarioJobRequest,
    _collect_provider_text,
    generate_test_scenario_artifacts,
    resume_requeued_test_scenario_job,
)


def _request(tmp_path, output_file: str = "f01-test-guide.md") -> TestScenarioJobRequest:
    source = tmp_path / "source"
    artifacts = tmp_path / "artifacts"
    source.mkdir(exist_ok=True)
    artifacts.mkdir(exist_ok=True)
    return TestScenarioJobRequest(
        stream_id="test-job-1",
        source_path=str(source),
        artifact_root=str(artifacts),
        provider="openai",
        model="test-model",
        items=[
            ScenarioPrompt(
                flow_id="F01",
                flow_name="Onboarding",
                output_file=output_file,
                prompt="Generate the scenarios",
            )
        ],
    )


def test_batch_writes_result_index_and_complete_manifest(tmp_path):
    request = _request(tmp_path)

    async def generate_text(_prompt, _item):
        return (
            "# F01 Test Guide\n\n"
            "## Happy Path\n" + "verified step\n" * 5
            + "## Data Integrity\n" + "verified data\n" * 5
            + "## Error Recovery\n" + "verified recovery\n" * 5
        )

    results = asyncio.run(generate_test_scenario_artifacts(request, generate_text))

    output_root = tmp_path / "artifacts" / "test-scenarios"
    manifest = json.loads((output_root / "manifest.json").read_text())
    assert (output_root / "f01-test-guide.md").exists()
    assert (output_root / "_index.md").exists()
    assert manifest["status"] == "completed"
    assert manifest["expected"] == 1
    assert manifest["succeeded"] == 1
    assert manifest["failed"] == 0
    assert results[0]["status"] == "succeeded"
    assert results[0]["sha256"]


def test_empty_provider_response_is_recorded_and_fails_the_batch(tmp_path):
    request = _request(tmp_path)

    async def generate_text(_prompt, _item):
        return ""

    with pytest.raises(TestScenarioBatchError):
        asyncio.run(generate_test_scenario_artifacts(request, generate_text))

    manifest_path = tmp_path / "artifacts" / "test-scenarios" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest["status"] == "failed"
    assert manifest["succeeded"] == 0
    assert manifest["failed"] == 1
    assert manifest["results"][0]["error_code"] == "empty_response"


def test_external_artifact_summary_is_not_accepted_as_scenario_content(tmp_path):
    request = _request(tmp_path)

    async def generate_text(_prompt, _item):
        return (
            "테스트 가이드를 생성했습니다.\n\n"
            "### 작업 요약\n"
            "- `## Happy Path` 작성\n"
            "- `## Data Integrity` 작성\n"
            "- `## Error Recovery` 작성\n"
            "[외부 파일](file:///tmp/test-guide.md)에서 확인하세요.\n"
        )

    with pytest.raises(TestScenarioBatchError):
        asyncio.run(generate_test_scenario_artifacts(request, generate_text))

    manifest_path = tmp_path / "artifacts" / "test-scenarios" / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert manifest["results"][0]["error_code"] == "missing_required_sections"


def test_output_filename_cannot_escape_artifact_directory(tmp_path):
    request = _request(tmp_path, "../outside.md")

    async def generate_text(_prompt, _item):
        return "# Valid\n## Happy Path\n## Data Integrity\n## Error Recovery\n" + "content\n" * 20

    with pytest.raises(TestScenarioBatchError):
        asyncio.run(generate_test_scenario_artifacts(request, generate_text))

    assert not (tmp_path / "artifacts" / "outside.md").exists()


@pytest.mark.asyncio
async def test_direct_api_provider_path_returns_valid_inline_markdown(tmp_path, monkeypatch):
    request = _request(tmp_path)
    request.use_cli = False
    request.provider = "openrouter"
    request.api_key = "test-key"
    item = request.items[0]
    captured = {}

    monkeypatch.setattr(
        "api.test_scenarios.provider_dispatcher.create_api_model",
        lambda _request: (object(), {}),
    )

    async def fake_api_stream(_model, _kwargs, _request, _system, _history, _file, prompt, _query, **_options):
        captured["prompt"] = prompt
        yield "# Guide\n## Happy Path\n" + "step\n" * 5
        yield "## Data Integrity\n" + "data\n" * 5 + "## Error Recovery\n" + "recover\n" * 5

    monkeypatch.setattr("api.test_scenarios.provider_dispatcher.api_stream", fake_api_stream)
    content = await _collect_provider_text(request, item, item.prompt, "missing-test-attempt")

    assert "## Data Integrity" in content
    assert "Do not create or reference another file" in captured["prompt"]


@pytest.mark.asyncio
async def test_restart_recovery_requeues_the_same_sanitized_request(tmp_path, monkeypatch):
    request = _request(tmp_path)
    queued = []

    async def fake_queue(restored, existing_job=False):
        queued.append((restored, existing_job))

    async def fake_emit(*_args, **_kwargs):
        return None

    monkeypatch.setattr("api.test_scenarios.queue_test_scenario_job", fake_queue)
    monkeypatch.setattr("api.test_scenarios.emit_task_event", fake_emit)
    reconciled = {
        "job_id": request.stream_id,
        "task_id": "test-scenarios",
        "payload_json": json.dumps({"request": request.model_dump(exclude={"api_key"})}),
    }

    assert await resume_requeued_test_scenario_job(reconciled) is True
    assert queued[0][0].stream_id == request.stream_id
    assert queued[0][0].api_key is None
    assert queued[0][1] is True


@pytest.mark.asyncio
async def test_completed_job_id_cannot_be_silently_reused(tmp_path, monkeypatch):
    request = _request(tmp_path)
    queued = False

    monkeypatch.setattr("api.routes.test_scenarios.job_store.get", lambda _job_id: {"status": "completed"})

    async def fake_queue(_request):
        nonlocal queued
        queued = True

    monkeypatch.setattr("api.routes.test_scenarios.queue_test_scenario_job", fake_queue)

    with pytest.raises(HTTPException) as error:
        await create_test_scenario_job(request)

    assert error.value.status_code == 409
    assert queued is False
