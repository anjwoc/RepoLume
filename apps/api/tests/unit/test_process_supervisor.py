from __future__ import annotations

import asyncio
import os
import sys

import pytest

from api.process_supervisor import (
    ProcessIdleTimeout,
    ProcessOverallTimeout,
    SupervisedProcess,
    get_process_fingerprint,
    terminate_process_tree_if_matches,
)


@pytest.mark.asyncio
async def test_supervisor_consumes_stdout_and_stderr_without_deadlock():
    process = await SupervisedProcess.start(
        [
            sys.executable,
            "-c",
            "import sys; print('out', flush=True); print('err', file=sys.stderr, flush=True)",
        ],
        idle_timeout=1,
        overall_timeout=5,
    )

    output = [(event.stream, event.data.decode().strip()) async for event in process.iter_output()]

    assert output == [("stdout", "out"), ("stderr", "err")]
    assert process.returncode == 0
    assert process.stderr_text.strip() == "err"


@pytest.mark.asyncio
async def test_supervisor_kills_an_idle_process_and_reaps_it():
    process = await SupervisedProcess.start(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        idle_timeout=0.1,
        overall_timeout=5,
        terminate_grace=0.1,
    )

    with pytest.raises(ProcessIdleTimeout):
        _ = [event async for event in process.iter_output()]

    assert process.returncode is not None


@pytest.mark.asyncio
async def test_overall_deadline_wins_even_when_output_stays_active():
    process = await SupervisedProcess.start(
        [
            sys.executable,
            "-c",
            "import time\nfor _ in range(100):\n print('tick', flush=True)\n time.sleep(0.03)",
        ],
        idle_timeout=1,
        overall_timeout=0.15,
        terminate_grace=0.1,
    )

    with pytest.raises(ProcessOverallTimeout):
        _ = [event async for event in process.iter_output()]

    assert process.returncode is not None


@pytest.mark.skipif(os.name == "nt", reason="POSIX process-group assertion")
@pytest.mark.asyncio
async def test_supervisor_terminates_descendants_in_the_child_process_group():
    process = await SupervisedProcess.start(
        [
            sys.executable,
            "-c",
            (
                "import subprocess,sys,time; "
                "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(30)']); "
                "print(child.pid, flush=True); time.sleep(30)"
            ),
        ],
        idle_timeout=0.15,
        overall_timeout=5,
        terminate_grace=0.1,
    )
    child_pid = None

    with pytest.raises(ProcessIdleTimeout):
        async for event in process.iter_output():
            if event.stream == "stdout":
                child_pid = int(event.data.decode().strip())

    assert child_pid is not None
    with pytest.raises(ProcessLookupError):
        os.kill(child_pid, 0)


@pytest.mark.skipif(os.name == "nt", reason="POSIX process-group assertion")
@pytest.mark.asyncio
async def test_restart_cleanup_requires_an_exact_process_fingerprint():
    process = await SupervisedProcess.start(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        idle_timeout=5,
        overall_timeout=30,
        terminate_grace=0.1,
    )
    fingerprint = await asyncio.to_thread(get_process_fingerprint, process.pid)
    assert fingerprint is not None

    mismatch = await asyncio.to_thread(
        terminate_process_tree_if_matches,
        process.pid,
        process.process_group_id,
        f"{fingerprint}-different",
        grace_seconds=0.1,
    )
    assert mismatch is False
    assert process.returncode is None

    matched = await asyncio.to_thread(
        terminate_process_tree_if_matches,
        process.pid,
        process.process_group_id,
        fingerprint,
        grace_seconds=0.1,
    )
    assert matched is True
    _ = [event async for event in process.iter_output()]
    assert process.returncode is not None
