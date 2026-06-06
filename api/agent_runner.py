"""
agent_runner.py — Python-native replacement for the localwiki-agent Go binary.

Runs local CLI tools (gemini, claude, codex, agy) as async subprocesses and
streams their stdout as JSONL events, matching the Go binary's output contract
exactly so existing callers need only a path change.

Supported agents:
  - gemini   : gemini CLI (Google One AI Premium subscription)
  - claude   : claude CLI (Anthropic Max subscription)
  - codex    : codex CLI (OpenAI Codex subscription)
  - antigravity : agy CLI (Antigravity)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RunResult:
    agent: str
    model: str
    content: str
    elapsed_ms: int
    error: str = ""


@dataclass
class JsonlEvent:
    type: str                   # "status" | "chunk" | "complete" | "error"
    agent: str = ""
    model: str = ""
    source: str = ""
    content: str = ""
    error: str = ""
    elapsed_ms: int = 0

    def to_json(self) -> str:
        d: Dict = {"type": self.type}
        if self.agent:
            d["agent"] = self.agent
        if self.model:
            d["model"] = self.model
        if self.source:
            d["source"] = self.source
        if self.content:
            d["content"] = self.content
        if self.error:
            d["error"] = self.error
        if self.elapsed_ms:
            d["elapsed_ms"] = str(self.elapsed_ms)
        return json.dumps(d, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Base runner
# ---------------------------------------------------------------------------

class BaseRunner(ABC):
    """Abstract base for all CLI agent runners."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    @abstractmethod
    def cli_binary(self) -> str: ...

    @property
    @abstractmethod
    def default_model(self) -> str: ...

    @property
    @abstractmethod
    def flash_model(self) -> str: ...

    @property
    @abstractmethod
    def pro_model(self) -> str: ...

    def available(self) -> bool:
        """Return True if the CLI binary is on PATH."""
        return shutil.which(self.cli_binary) is not None

    def resolve_model(self, model_override: str = "") -> str:
        return model_override if model_override else self.default_model

    @abstractmethod
    def _build_args(self, model: str) -> List[str]:
        """Build the CLI argument list (excluding binary name and prompt)."""
        ...

    def _build_args_for_prompt(self, model: str, prompt: str) -> List[str]:
        """Build CLI arguments when the prompt must be passed as an argument."""
        return self._build_args(model)

    def _build_stdin(self, prompt: str) -> str:
        """Return the string to pass to stdin (default: prompt as-is)."""
        return prompt

    def _build_env(self) -> Dict[str, str]:
        """Return runner-specific environment overrides."""
        return {}

    async def run_collect(
        self,
        prompt: str,
        cwd: str = ".",
        model: str = "",
        timeout: int = 300,
        env: Optional[Dict[str, str]] = None,
    ) -> RunResult:
        """Run the CLI agent and collect the full output synchronously."""
        resolved_model = self.resolve_model(model)
        args = self._build_args_for_prompt(resolved_model, prompt)
        stdin_text = self._build_stdin(prompt)
        proc_env = {**os.environ, **self._build_env(), **(env or {})}

        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                self.cli_binary,
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=proc_env,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(stdin_text.encode()),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return RunResult(
                agent=self.name,
                model=resolved_model,
                content="",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                error=f"Timeout after {timeout}s",
            )
        except Exception as exc:
            return RunResult(
                agent=self.name,
                model=resolved_model,
                content="",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                error=str(exc),
            )

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        content = stdout_bytes.decode("utf-8", errors="replace")
        content = self._post_process(content)

        err_str = stderr_bytes.decode("utf-8", errors="replace").strip()
        if proc.returncode != 0:
            logger.error(
                f"[{self.name}] exited {proc.returncode}: {err_str}"
            )
            return RunResult(
                agent=self.name,
                model=resolved_model,
                content=content,
                elapsed_ms=elapsed_ms,
                error=err_str or f"Exit code {proc.returncode}",
            )

        return RunResult(
            agent=self.name,
            model=resolved_model,
            content=content,
            elapsed_ms=elapsed_ms,
        )

    async def run_stream_jsonl(
        self,
        prompt: str,
        cwd: str = ".",
        model: str = "",
        timeout: int = 300,
        env: Optional[Dict[str, str]] = None,
    ) -> AsyncIterator[JsonlEvent]:
        """
        Run the CLI agent and yield JSONL events compatible with the old
        Go binary's --stream-jsonl output format.
        """
        resolved_model = self.resolve_model(model)
        args = self._build_args_for_prompt(resolved_model, prompt)
        stdin_text = self._build_stdin(prompt)
        proc_env = {**os.environ, **self._build_env(), **(env or {})}

        yield JsonlEvent(
            type="status",
            agent=self.name,
            model=resolved_model,
            content="agent started",
        )

        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                self.cli_binary,
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=proc_env,
            )
            # Write stdin without blocking the read loop
            if proc.stdin:
                proc.stdin.write(stdin_text.encode())
                await proc.stdin.drain()
                proc.stdin.close()

            full_chunks: List[str] = []

            while True:
                try:
                    # Apply timeout per-line so long generations don't timeout overall
                    raw_line = await asyncio.wait_for(proc.stdout.readline(), timeout=timeout)
                except asyncio.TimeoutError:
                    proc.kill()
                    yield JsonlEvent(
                        type="error",
                        agent=self.name,
                        model=resolved_model,
                        error=f"Timeout after {timeout}s",
                    )
                    return

                if not raw_line:
                    break

                line = raw_line.decode("utf-8", errors="replace")
                
                # Yield chunk immediately for streaming
                yield JsonlEvent(
                    type="chunk",
                    agent=self.name,
                    model=resolved_model,
                    content=line
                )
                full_chunks.append(line)

            await proc.wait()
            stderr_bytes = await proc.stderr.read()  # type: ignore[union-attr]
            err_str = stderr_bytes.decode("utf-8", errors="replace").strip()
            elapsed_ms = int((time.monotonic() - t0) * 1000)

            # Reconstruct full output and post-process for complete event
            # But do not send content in complete event to avoid duplication in UI
            # since we already streamed the chunks.
            full_output = self._post_process("".join(full_chunks))

            if proc.returncode != 0:
                yield JsonlEvent(
                    type="error",
                    agent=self.name,
                    model=resolved_model,
                    error=err_str or f"Exit code {proc.returncode}",
                )
                return

            yield JsonlEvent(
                type="complete",
                agent=self.name,
                model=resolved_model,
                content="", # Empty content so simple_chat.py doesn't duplicate it
                elapsed_ms=elapsed_ms,
            )

        except Exception as exc:
            yield JsonlEvent(
                type="error",
                agent=self.name,
                model=resolved_model,
                error=str(exc),
            )

    def _post_process(self, output: str) -> str:
        """Optional post-processing of raw stdout. Override in subclasses."""
        return output.strip()


# ---------------------------------------------------------------------------
# Concrete runners
# ---------------------------------------------------------------------------

class GeminiRunner(BaseRunner):
    """
    Runs prompts via the `gemini` CLI (Google One AI Premium).
    Auth: gemini auth  (OAuth — do NOT pass GEMINI_API_KEY)
    """

    def __init__(self, model_override: str = ""):
        self._model_override = model_override

    @property
    def name(self) -> str:
        return "gemini"

    @property
    def cli_binary(self) -> str:
        return "gemini"

    @property
    def default_model(self) -> str:
        return "gemini-2.5-flash"

    @property
    def flash_model(self) -> str:
        return "gemini-2.5-flash"

    @property
    def pro_model(self) -> str:
        return "gemini-2.5-pro"

    def resolve_model(self, model_override: str = "") -> str:
        m = model_override or self._model_override
        return m if m else self.default_model

    def _build_args(self, model: str) -> List[str]:
        args = ["--skip-trust"]
        if model:
            args += ["--model", model]
        return args

    def _build_args_for_prompt(self, model: str, prompt: str) -> List[str]:
        args = ["--skip-trust", "--prompt", prompt]
        if model:
            args += ["--model", model]
        return args

    def _build_stdin(self, prompt: str) -> str:
        return ""

    def _build_env(self) -> Dict[str, str]:
        return {"GEMINI_CLI_TRUST_WORKSPACE": "true"}


class ClaudeRunner(BaseRunner):
    """
    Runs prompts via the `claude` CLI (Anthropic Max subscription).
    Install: npm install -g @anthropic-ai/claude-code
    """

    def __init__(self, model_override: str = ""):
        self._model_override = model_override

    @property
    def name(self) -> str:
        return "claude"

    @property
    def cli_binary(self) -> str:
        return "claude"

    @property
    def default_model(self) -> str:
        return "claude-haiku-3-5"

    @property
    def flash_model(self) -> str:
        return "claude-haiku-3-5"

    @property
    def pro_model(self) -> str:
        return "claude-sonnet-4-5"

    def resolve_model(self, model_override: str = "") -> str:
        m = model_override or self._model_override
        return m if m else self.default_model

    def _build_args(self, model: str) -> List[str]:
        # claude -p PROMPT --model MODEL --output-format text
        # Prompt is passed as a positional arg (not stdin) for Claude CLI
        args: List[str] = ["--dangerously-skip-permissions"]
        if model:
            args += ["--model", model]
        args += ["--output-format", "text"]
        return args

    def _build_stdin(self, prompt: str) -> str:
        return prompt

    async def run_collect(
        self,
        prompt: str,
        cwd: str = ".",
        model: str = "",
        timeout: int = 300,
        env: Optional[Dict[str, str]] = None,
    ) -> RunResult:
        # Claude CLI takes prompt as positional arg, not stdin
        resolved_model = self.resolve_model(model)
        proc_env = {**os.environ, **(env or {})}

        args = ["-p", prompt, "--dangerously-skip-permissions"]
        if resolved_model:
            args += ["--model", resolved_model]
        args += ["--output-format", "text"]

        t0 = time.monotonic()
        try:
            proc = await asyncio.create_subprocess_exec(
                self.cli_binary,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
                env=proc_env,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            return RunResult(
                agent=self.name, model=resolved_model, content="",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                error=f"Timeout after {timeout}s",
            )
        except Exception as exc:
            return RunResult(
                agent=self.name, model=resolved_model, content="",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
                error=str(exc),
            )

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        content = stdout_bytes.decode("utf-8", errors="replace").strip()
        err_str = stderr_bytes.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            return RunResult(
                agent=self.name, model=resolved_model, content=content,
                elapsed_ms=elapsed_ms,
                error=err_str or f"Exit code {proc.returncode}",
            )
        return RunResult(
            agent=self.name, model=resolved_model, content=content,
            elapsed_ms=elapsed_ms,
        )


class CodexRunner(BaseRunner):
    """
    Runs prompts via the `codex exec` subcommand (OpenAI Codex subscription).
    Prompt is passed via stdin to avoid ARG_MAX limits.
    """

    def __init__(self, model_override: str = "", sandbox_perms: str = "disk-full-read-access"):
        self._model_override = model_override
        self._sandbox_perms = sandbox_perms

    @property
    def name(self) -> str:
        return "codex"

    @property
    def cli_binary(self) -> str:
        return "codex"

    @property
    def default_model(self) -> str:
        return "gpt-5.5-mini"

    @property
    def flash_model(self) -> str:
        return "gpt-5.5-mini"

    @property
    def pro_model(self) -> str:
        return "gpt-5.5"

    def resolve_model(self, model_override: str = "") -> str:
        m = model_override or self._model_override
        return m if m else self.default_model

    def _build_args(self, model: str) -> List[str]:
        args = ["exec", "--dangerously-bypass-approvals-and-sandbox"]
        if model:
            args += ["-c", f'model="{model}"']
        perms = self._sandbox_perms or "disk-full-read-access"
        args += ["-c", f'sandbox_permissions=["{perms}"]']
        return args

    def _build_stdin(self, prompt: str) -> str:
        return prompt

    def _post_process(self, output: str) -> str:
        """
        Strip the codex CLI header/footer lines:
          codex\n<content>\ntokens used\n<number>
        """
        lines = output.split("\n")
        result: List[str] = []
        started = False
        for line in lines:
            stripped = line.strip()
            if not started:
                if stripped == "codex":
                    started = True
                continue
            if stripped == "tokens used":
                break
            result.append(line)

        if not started:
            # Fallback: return as-is
            return output.strip()
        return "\n".join(result).strip()


class AntigravityRunner(BaseRunner):
    """
    Runs prompts via the `agy` CLI (Antigravity IDE agent).
    Injects a strict instruction to prevent file writes and force stdout output.
    """

    _STRICT_SUFFIX = (
        "\n\nCRITICAL INSTRUCTION: DO NOT use any tools to create files or save "
        "documents to the workspace or artifact directory. You MUST output the "
        "final requested content directly as plain text to "
        "standard output so the caller can read it. Do not include any "
        "conversational filler, output ONLY the raw requested format (e.g., JSON or Markdown)."
    )

    @property
    def name(self) -> str:
        return "antigravity"

    @property
    def cli_binary(self) -> str:
        return "agy"

    @property
    def default_model(self) -> str:
        return "gemini-3.5-flash"

    @property
    def flash_model(self) -> str:
        return "gemini-3.5-flash"

    @property
    def pro_model(self) -> str:
        return "gemini-3.5-pro"

    def _build_args(self, model: str) -> List[str]:
        args = ["--dangerously-skip-permissions"]
        if model:
            args += ["--model", model]
        return args

    def _build_args_for_prompt(self, model: str, prompt: str) -> List[str]:
        args = ["--dangerously-skip-permissions", "--prompt", ""]
        if model:
            args += ["--model", model]
        return args

    def _build_stdin(self, prompt: str) -> str:
        return prompt + self._STRICT_SUFFIX

    async def run_collect(self, prompt: str, cwd: str = ".", model: str = "", timeout: int = 300, env: Optional[Dict[str, str]] = None) -> RunResult:
        new_env = {**(env or {}), "BROWSER": "none"}
        return await super().run_collect(prompt, cwd, model, timeout, new_env)

    async def run_stream_jsonl(self, prompt: str, cwd: str = ".", model: str = "", timeout: int = 300, env: Optional[Dict[str, str]] = None) -> AsyncIterator[JsonlEvent]:
        new_env = {**(env or {}), "BROWSER": "none"}
        async for event in super().run_stream_jsonl(prompt, cwd, model, timeout, new_env):
            yield event


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class AgentRegistry:
    """Lookup and availability check for all CLI runners."""

    _RUNNERS: Dict[str, BaseRunner] = {}

    def __init__(
        self,
        gemini_model: str = "",
        codex_model: str = "",
        claude_model: str = "",
    ):
        self._registry: Dict[str, BaseRunner] = {
            "gemini": GeminiRunner(gemini_model),
            "claude": ClaudeRunner(claude_model),
            "codex": CodexRunner(codex_model),
            "antigravity": AntigravityRunner(),
        }

    def get(self, name: str) -> BaseRunner:
        runner = self._registry.get(name)
        if runner is None:
            raise ValueError(
                f"Unknown agent '{name}'. "
                f"Available: {', '.join(self._registry.keys())}"
            )
        return runner

    def available(self) -> List[str]:
        """Return list of agent names whose CLI binary is on PATH."""
        return [name for name, r in self._registry.items() if r.available()]

    def all_names(self) -> List[str]:
        return list(self._registry.keys())

    def status(self) -> List[Dict]:
        result = []
        for name, runner in self._registry.items():
            result.append({
                "name": name,
                "available": runner.available(),
                "default_model": runner.default_model,
                "flash_model": runner.flash_model,
                "pro_model": runner.pro_model,
            })
        return result
