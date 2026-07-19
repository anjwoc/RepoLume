from __future__ import annotations

import asyncio
from pathlib import Path
import threading
import time
from types import SimpleNamespace

import pytest

from api.chat import provider_dispatcher
from api.db.generation_jobs import GenerationJobStore, TaskDefinition


def _request(agent: str) -> SimpleNamespace:
    return SimpleNamespace(
        cli_tool=agent,
        model="",
        api_key=None,
        provider="openrouter" if agent == "openrouter" else agent,
        repo_url=".",
        stream_id=None,
        litellm_base_url=None,
    )


def _write_fake_agent(path: Path, source: str) -> None:
    path.write_text("#!/usr/bin/env python3\n" + source)
    path.chmod(0o755)


@pytest.mark.parametrize("agent", ["antigravity", "codex", "claude"])
@pytest.mark.asyncio
async def test_required_cli_providers_use_supervised_attempts(
    tmp_path,
    monkeypatch,
    agent,
):
    fake_agent = tmp_path / "localwiki-agent"
    _write_fake_agent(
        fake_agent,
        (
            "import json,sys\n"
            "agent=sys.argv[sys.argv.index('--agent')+1]\n"
            "print(json.dumps({'type':'status','content':'started'}), flush=True)\n"
            "print(json.dumps({'type':'chunk','content':agent+'-ok'}), flush=True)\n"
            "print(json.dumps({'type':'complete','content':agent+'-ok'}), flush=True)\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)

    chunks = [
        chunk
        async for chunk in provider_dispatcher.cli_stream(
            _request(agent),
            "Return OK",
            generation_job_id="job-1",
            generation_task_id="page-1",
            raise_on_error=True,
        )
    ]

    assert chunks == [f"{agent}-ok"]
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "succeeded"
    assert task["attempt_count"] == 1


@pytest.mark.parametrize("agent", ["antigravity", "codex", "claude"])
@pytest.mark.asyncio
async def test_required_cli_providers_fail_empty_output_after_retry_budget(
    tmp_path,
    monkeypatch,
    agent,
):
    fake_agent = tmp_path / "localwiki-agent"
    count_file = tmp_path / "count"
    _write_fake_agent(
        fake_agent,
        (
            "import pathlib\n"
            f"count=pathlib.Path({str(count_file)!r})\n"
            "count.write_text(str(int(count.read_text())+1) if count.exists() else '1')\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(provider_dispatcher, "_EMPTY_RETRY_DELAYS", [0])
    monkeypatch.setattr(provider_dispatcher, "_MAX_EMPTY_RETRIES", 1)
    if agent == "antigravity":
        monkeypatch.setattr(provider_dispatcher, "_check_agy_quota_error", lambda *_: None)

    with pytest.raises(provider_dispatcher.CliExecutionError):
        _ = [
            chunk
            async for chunk in provider_dispatcher.cli_stream(
                _request(agent),
                "empty",
                generation_job_id="job-1",
                generation_task_id="page-1",
                raise_on_error=True,
            )
        ]

    assert count_file.read_text() == "2"
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "failed"
    assert task["attempt_count"] == 2


@pytest.mark.parametrize("agent", ["antigravity", "codex", "claude"])
@pytest.mark.asyncio
async def test_required_cli_providers_fail_nonzero_exit_without_retry(
    tmp_path,
    monkeypatch,
    agent,
):
    fake_agent = tmp_path / "localwiki-agent"
    count_file = tmp_path / "count"
    _write_fake_agent(
        fake_agent,
        (
            "import pathlib,sys\n"
            f"count=pathlib.Path({str(count_file)!r})\n"
            "count.write_text(str(int(count.read_text())+1) if count.exists() else '1')\n"
            "print('provider failed', file=sys.stderr, flush=True)\n"
            "raise SystemExit(7)\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    if agent == "antigravity":
        monkeypatch.setattr(provider_dispatcher, "_check_agy_quota_error", lambda *_: None)

    with pytest.raises(provider_dispatcher.CliExecutionError, match="provider failed"):
        _ = [
            chunk
            async for chunk in provider_dispatcher.cli_stream(
                _request(agent),
                "nonzero",
                generation_job_id="job-1",
                generation_task_id="page-1",
                raise_on_error=True,
            )
        ]

    assert count_file.read_text() == "1"
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "failed"
    assert task["error_code"] == "nonzero_exit"
    assert task["attempt_count"] == 1


def test_agy_quota_detection_ignores_log_entries_from_previous_attempts(
    tmp_path,
    monkeypatch,
):
    log = tmp_path / "cli.log"
    log.write_text("RESOURCE_EXHAUSTED old request Resets in 1 hour\n")
    monkeypatch.setattr(provider_dispatcher, "_AGY_CLI_LOG", log)
    offset = provider_dispatcher._agy_log_offset()

    assert provider_dispatcher._check_agy_quota_error(offset) is None

    with log.open("a") as handle:
        handle.write("RESOURCE_EXHAUSTED new request Resets in 5 minutes\n")
    assert "5 minutes" in provider_dispatcher._check_agy_quota_error(offset)


@pytest.mark.asyncio
async def test_cli_idle_timeout_is_terminal_and_not_reported_as_success(tmp_path, monkeypatch):
    fake_agent = tmp_path / "localwiki-agent"
    _write_fake_agent(fake_agent, "import time\ntime.sleep(30)\n")
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(provider_dispatcher, "_CLI_IDLE_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(provider_dispatcher, "_CLI_OVERALL_TIMEOUT_SECONDS", 1)
    monkeypatch.setattr(provider_dispatcher, "_MAX_EMPTY_RETRIES", 0)

    with pytest.raises(provider_dispatcher.CliExecutionError):
        _ = [
            chunk
            async for chunk in provider_dispatcher.cli_stream(
                _request("codex"),
                "hang",
                generation_job_id="job-1",
                generation_task_id="page-1",
                raise_on_error=True,
            )
        ]

    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "failed"
    assert task["error_code"] == "idle_timeout"
    assert ledger.completeness("job-1")["complete"] is True


@pytest.mark.asyncio
async def test_partial_cli_timeout_is_not_retried_or_duplicated(tmp_path, monkeypatch):
    fake_agent = tmp_path / "localwiki-agent"
    _write_fake_agent(fake_agent, "")
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    starts = 0

    class PartialThenTimedOut:
        pid = 123
        process_group_id = 123
        stderr_text = ""
        returncode = None

        async def iter_output(self):
            yield SimpleNamespace(
                stream="stdout",
                data=b'{"type":"chunk","content":"partial"}\n',
            )
            raise provider_dispatcher.ProcessIdleTimeout("idle after partial response")

    async def start(*args, **kwargs):
        nonlocal starts
        starts += 1
        return PartialThenTimedOut()

    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(
        provider_dispatcher,
        "SupervisedProcess",
        SimpleNamespace(start=start),
    )
    monkeypatch.setattr(provider_dispatcher, "_EMPTY_RETRY_DELAYS", [0, 0])

    chunks: list[str] = []
    with pytest.raises(provider_dispatcher.CliExecutionError):
        async for chunk in provider_dispatcher.cli_stream(
            _request("codex"),
            "partial then hang",
            generation_job_id="job-1",
            generation_task_id="page-1",
            raise_on_error=True,
        ):
            chunks.append(chunk)

    assert chunks == ["partial"]
    assert starts == 1
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "timed_out"
    assert task["attempt_count"] == 1


@pytest.mark.asyncio
async def test_agy_account_rotation_is_serialized_and_atomic(tmp_path, monkeypatch):
    accounts = [tmp_path / f"account-{index}.json" for index in range(3)]
    active = 0
    max_active = 0
    rotated: list[Path] = []
    guard = threading.Lock()

    def replace(source: Path) -> None:
        nonlocal active, max_active
        with guard:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.02)
        rotated.append(source)
        with guard:
            active -= 1

    monkeypatch.setattr(provider_dispatcher, "_get_agy_accounts", lambda: accounts)
    monkeypatch.setattr(provider_dispatcher, "_replace_agy_token", replace)
    monkeypatch.setattr(provider_dispatcher, "_agy_account_index", 0)
    monkeypatch.setattr(provider_dispatcher, "_agy_rotation_lock", None)

    results = await asyncio.gather(
        provider_dispatcher._rotate_agy_account(),
        provider_dispatcher._rotate_agy_account(),
    )

    assert results == [True, True]
    assert max_active == 1
    assert rotated == [accounts[1], accounts[2]]
    assert provider_dispatcher._agy_account_index == 2


@pytest.mark.asyncio
async def test_agy_quota_rotates_once_then_succeeds_with_a_new_attempt(tmp_path, monkeypatch):
    fake_agent = tmp_path / "localwiki-agent"
    count_file = tmp_path / "count"
    _write_fake_agent(
        fake_agent,
        (
            "import json,pathlib\n"
            f"count=pathlib.Path({str(count_file)!r})\n"
            "attempt=int(count.read_text())+1 if count.exists() else 1\n"
            "count.write_text(str(attempt))\n"
            "if attempt > 1:\n"
            " print(json.dumps({'type':'chunk','content':'antigravity-ok'}), flush=True)\n"
            " print(json.dumps({'type':'complete','content':'antigravity-ok'}), flush=True)\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    rotations: list[bool] = []

    async def rotate() -> bool:
        rotations.append(True)
        return True

    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(
        provider_dispatcher,
        "_check_agy_quota_error",
        lambda *_: "quota exhausted",
    )
    monkeypatch.setattr(provider_dispatcher, "_get_agy_accounts", lambda: [tmp_path / "one.json"])
    monkeypatch.setattr(provider_dispatcher, "_rotate_agy_account", rotate)
    monkeypatch.setattr(provider_dispatcher, "_EMPTY_RETRY_DELAYS", [0, 0])
    monkeypatch.setattr(provider_dispatcher, "_MAX_EMPTY_RETRIES", 2)

    chunks = [
        chunk
        async for chunk in provider_dispatcher.cli_stream(
            _request("antigravity"),
            "retry after quota",
            generation_job_id="job-1",
            generation_task_id="page-1",
            raise_on_error=True,
        )
    ]

    assert chunks == ["antigravity-ok"]
    assert rotations == [True]
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "succeeded"
    assert task["attempt_count"] == 2


@pytest.mark.asyncio
async def test_agy_quota_without_configured_accounts_fails_without_retry(tmp_path, monkeypatch):
    fake_agent = tmp_path / "localwiki-agent"
    count_file = tmp_path / "count"
    _write_fake_agent(
        fake_agent,
        (
            "import pathlib\n"
            f"count=pathlib.Path({str(count_file)!r})\n"
            "count.write_text(str(int(count.read_text())+1) if count.exists() else '1')\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(
        provider_dispatcher,
        "_check_agy_quota_error",
        lambda *_: "quota exhausted",
    )
    monkeypatch.setattr(provider_dispatcher, "_get_agy_accounts", lambda: [])
    monkeypatch.setattr(provider_dispatcher, "_EMPTY_RETRY_DELAYS", [0, 0])
    monkeypatch.setattr(provider_dispatcher, "_MAX_EMPTY_RETRIES", 2)

    with pytest.raises(provider_dispatcher.CliExecutionError, match="quota exhausted"):
        _ = [
            chunk
            async for chunk in provider_dispatcher.cli_stream(
                _request("antigravity"),
                "quota without fallback",
                generation_job_id="job-1",
                generation_task_id="page-1",
                raise_on_error=True,
            )
        ]

    assert count_file.read_text() == "1"
    task = ledger.get_task("job-1", "page-1")
    assert task["status"] == "failed"
    assert task["error_code"] == "quota_exhausted"
    assert task["attempt_count"] == 1


@pytest.mark.asyncio
async def test_cli_attempt_emits_persisted_heartbeat_while_waiting(tmp_path, monkeypatch):
    fake_agent = tmp_path / "localwiki-agent"
    _write_fake_agent(
        fake_agent,
        (
            "import json,time\n"
            "time.sleep(0.05)\n"
            "print(json.dumps({'type':'complete','content':'ok'}), flush=True)\n"
        ),
    )
    ledger = GenerationJobStore(tmp_path / "ledger.db")
    ledger.register_tasks("job-1", [TaskDefinition("page-1", "cli")])
    request = _request("codex")
    request.stream_id = "job-1"
    events: list[str] = []

    async def emit(_stream_id, event_type, *_args, **_kwargs):
        events.append(str(event_type))

    monkeypatch.setattr(provider_dispatcher, "_get_agent_bin", lambda: fake_agent)
    monkeypatch.setattr(provider_dispatcher, "generation_job_store", ledger)
    monkeypatch.setattr(provider_dispatcher, "emit_task_event", emit)
    monkeypatch.setattr(provider_dispatcher, "_CLI_HEARTBEAT_SECONDS", 0.01)

    chunks = [
        chunk
        async for chunk in provider_dispatcher.cli_stream(
            request,
            "wait then respond",
            generation_job_id="job-1",
            generation_task_id="page-1",
            raise_on_error=True,
        )
    ]

    task = ledger.get_task("job-1", "page-1")
    attempt = ledger.get_attempt(task["active_attempt_id"])
    assert chunks == ["ok"]
    assert "heartbeat" in events
    assert attempt["last_heartbeat_at"] is not None


def test_openrouter_uses_the_request_api_key(monkeypatch):
    monkeypatch.setattr(
        provider_dispatcher,
        "get_model_config",
        lambda provider, model: {"model_kwargs": {"temperature": 0.2}},
    )
    request = _request("openrouter")
    request.model = "openai/gpt-4o-mini"
    request.api_key = "request-key"

    client, kwargs = provider_dispatcher.create_api_model(request)

    assert client.sync_client["api_key"] == "request-key"
    assert kwargs["model"] == "openai/gpt-4o-mini"


@pytest.mark.asyncio
async def test_openrouter_provider_errors_raise_in_background_mode():
    class FailingOpenRouter:
        def convert_inputs_to_api_kwargs(self, **kwargs):
            return kwargs

        async def acall(self, **kwargs):
            raise RuntimeError("openrouter unavailable")

    request = _request("openrouter")
    request.model = "openai/gpt-4o-mini"

    with pytest.raises(RuntimeError, match="openrouter unavailable"):
        _ = [
            chunk
            async for chunk in provider_dispatcher.api_stream(
                FailingOpenRouter(),
                {"model": request.model},
                request,
                "system",
                "history",
                "files",
                "prompt",
                "query",
                raise_on_error=True,
            )
        ]


@pytest.mark.asyncio
async def test_openrouter_dispatch_preserves_string_chunks():
    class WorkingOpenRouter:
        def convert_inputs_to_api_kwargs(self, **kwargs):
            return kwargs

        async def acall(self, **kwargs):
            async def response():
                yield "openrouter-ok"

            return response()

    request = _request("openrouter")
    chunks = [
        chunk
        async for chunk in provider_dispatcher._dispatch_to_provider(
            WorkingOpenRouter(),
            {"model": "test"},
            request,
            "prompt",
        )
    ]

    assert chunks == ["openrouter-ok"]


@pytest.mark.asyncio
async def test_openrouter_partial_failure_is_not_replayed_and_duplicated():
    class PartialOpenRouter:
        def __init__(self) -> None:
            self.calls = 0

        def convert_inputs_to_api_kwargs(self, **kwargs):
            return kwargs

        async def acall(self, **kwargs):
            self.calls += 1

            async def response():
                yield "partial"
                raise RuntimeError("maximum context length reached after partial output")

            return response()

    model = PartialOpenRouter()
    request = _request("openrouter")
    chunks: list[str] = []

    with pytest.raises(RuntimeError, match="maximum context length"):
        async for chunk in provider_dispatcher.api_stream(
            model,
            {"model": "test"},
            request,
            "system",
            "history",
            "files",
            "prompt",
            "query",
            raise_on_error=True,
        ):
            chunks.append(chunk)

    assert chunks == ["partial"]
    assert model.calls == 1
