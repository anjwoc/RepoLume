from __future__ import annotations

import asyncio
import os
import signal
import subprocess
import time
from dataclasses import dataclass
from typing import AsyncIterator, Literal, Mapping, Sequence


class ProcessSupervisionError(RuntimeError):
    pass


class ProcessIdleTimeout(ProcessSupervisionError):
    pass


class ProcessOverallTimeout(ProcessSupervisionError):
    pass


def get_process_fingerprint(pid: int) -> str | None:
    if pid <= 0:
        return None
    if os.name == "nt":
        command = [
            "powershell",
            "-NoProfile",
            "-Command",
            f"(Get-Process -Id {pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks",
        ]
    else:
        command = ["ps", "-o", "lstart=", "-p", str(pid)]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    fingerprint = result.stdout.strip()
    return fingerprint or None


def terminate_process_tree_if_matches(
    pid: int,
    process_group_id: int | None,
    expected_fingerprint: str | None,
    *,
    grace_seconds: float = 1,
) -> bool:
    if not expected_fingerprint or get_process_fingerprint(pid) != expected_fingerprint:
        return False
    if os.name == "nt":
        result = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            timeout=max(2, grace_seconds + 1),
            check=False,
        )
        return result.returncode == 0
    try:
        actual_group_id = os.getpgid(pid)
    except ProcessLookupError:
        return True
    if process_group_id is None or actual_group_id != process_group_id:
        return False
    try:
        os.killpg(process_group_id, signal.SIGTERM)
    except ProcessLookupError:
        return True
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        time.sleep(0.02)
    try:
        os.killpg(process_group_id, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return True


@dataclass(frozen=True)
class ProcessOutput:
    stream: Literal["stdout", "stderr"]
    data: bytes


class SupervisedProcess:
    _STDERR_LIMIT = 1024 * 1024

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        *,
        idle_timeout: float | None,
        overall_timeout: float | None,
        terminate_grace: float,
    ) -> None:
        self.process = process
        self.idle_timeout = idle_timeout
        self.overall_timeout = overall_timeout
        self.terminate_grace = terminate_grace
        self.started_at = time.monotonic()
        self.last_activity_at = self.started_at
        self._queue: asyncio.Queue[tuple[Literal["stdout", "stderr"], bytes | None]] = (
            asyncio.Queue(maxsize=256)
        )
        self._stderr = bytearray()
        self._termination_lock = asyncio.Lock()
        self._pump_tasks = [
            asyncio.create_task(self._pump("stdout", process.stdout)),
            asyncio.create_task(self._pump("stderr", process.stderr)),
        ]

    @classmethod
    async def start(
        cls,
        command: Sequence[str],
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
        stdin: bytes | None = None,
        idle_timeout: float | None = 300,
        overall_timeout: float | None = 1200,
        terminate_grace: float = 5,
        stream_limit: int = 100 * 1024 * 1024,
    ) -> "SupervisedProcess":
        if not command:
            raise ValueError("command must not be empty")
        if idle_timeout is not None and idle_timeout <= 0:
            raise ValueError("idle_timeout must be positive")
        if overall_timeout is not None and overall_timeout <= 0:
            raise ValueError("overall_timeout must be positive")

        spawn_options: dict[str, object] = {}
        if os.name == "nt":
            spawn_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            spawn_options["start_new_session"] = True

        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            env=dict(env) if env is not None else None,
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=stream_limit,
            **spawn_options,
        )
        supervised = cls(
            process,
            idle_timeout=idle_timeout,
            overall_timeout=overall_timeout,
            terminate_grace=terminate_grace,
        )
        if stdin is not None and process.stdin is not None:
            try:
                process.stdin.write(stdin)
                await process.stdin.drain()
            finally:
                process.stdin.close()
        return supervised

    @property
    def pid(self) -> int:
        return self.process.pid

    @property
    def process_group_id(self) -> int | None:
        return self.process.pid if os.name != "nt" else None

    @property
    def returncode(self) -> int | None:
        return self.process.returncode

    @property
    def stderr_text(self) -> str:
        return self._stderr.decode("utf-8", errors="replace")

    async def _pump(
        self,
        stream: Literal["stdout", "stderr"],
        reader: asyncio.StreamReader | None,
    ) -> None:
        if reader is None:
            await self._queue.put((stream, None))
            return
        try:
            while True:
                data = await reader.readline()
                await self._queue.put((stream, data or None))
                if not data:
                    return
        except asyncio.CancelledError:
            raise
        except Exception:
            await self._queue.put((stream, None))

    def _next_deadline(self) -> tuple[float | None, type[ProcessSupervisionError] | None]:
        now = time.monotonic()
        candidates: list[tuple[float, type[ProcessSupervisionError]]] = []
        if self.idle_timeout is not None:
            candidates.append(
                (self.last_activity_at + self.idle_timeout, ProcessIdleTimeout)
            )
        if self.overall_timeout is not None:
            candidates.append((self.started_at + self.overall_timeout, ProcessOverallTimeout))
        if not candidates:
            return None, None
        deadline, error_type = min(candidates, key=lambda item: item[0])
        return max(0, deadline - now), error_type

    async def iter_output(self) -> AsyncIterator[ProcessOutput]:
        eof_streams: set[str] = set()
        try:
            while len(eof_streams) < 2:
                timeout, timeout_error = self._next_deadline()
                try:
                    if timeout is None:
                        stream, data = await self._queue.get()
                    else:
                        stream, data = await asyncio.wait_for(self._queue.get(), timeout)
                except asyncio.TimeoutError as exc:
                    await self.terminate()
                    error_name = "idle" if timeout_error is ProcessIdleTimeout else "overall"
                    raise timeout_error(
                        f"Process {self.pid} exceeded its {error_name} deadline"
                    ) from exc

                if data is None:
                    eof_streams.add(stream)
                    continue

                self.last_activity_at = time.monotonic()
                if stream == "stderr":
                    self._stderr.extend(data)
                    if len(self._stderr) > self._STDERR_LIMIT:
                        del self._stderr[: len(self._stderr) - self._STDERR_LIMIT]
                yield ProcessOutput(stream=stream, data=data)

            await self.process.wait()
        except BaseException:
            if self.process.returncode is None:
                await self.terminate()
            raise
        finally:
            if self.process.returncode is not None:
                await asyncio.gather(*self._pump_tasks, return_exceptions=True)

    async def terminate(self) -> None:
        async with self._termination_lock:
            if self.process.returncode is not None:
                await self.process.wait()
                return

            if os.name == "nt":
                self.process.terminate()
            else:
                try:
                    os.killpg(self.process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass

            try:
                await asyncio.wait_for(self.process.wait(), timeout=self.terminate_grace)
                return
            except asyncio.TimeoutError:
                pass

            if os.name == "nt":
                killer = await asyncio.create_subprocess_exec(
                    "taskkill",
                    "/PID",
                    str(self.process.pid),
                    "/T",
                    "/F",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await killer.wait()
                if self.process.returncode is None:
                    self.process.kill()
            else:
                try:
                    os.killpg(self.process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            await self.process.wait()
