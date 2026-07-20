from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.agent_runner import (  # noqa: E402
    AgentRegistry,
    AntigravityRunner,
    CodexRunner,
    GeminiRunner,
)


def test_gemini_runner_uses_supported_default_models():
    runner = GeminiRunner()

    assert runner.default_model == "gemini-2.5-flash"
    assert runner.flash_model == "gemini-2.5-flash"
    assert runner.pro_model == "gemini-2.5-pro"


def test_gemini_runner_passes_prompt_as_cli_argument_for_headless_mode():
    runner = GeminiRunner()
    args = runner._build_args_for_prompt("gemini-2.5-flash", "Return exactly: OK")

    assert args == [
        "--skip-trust",
        "--prompt",
        "Return exactly: OK",
        "--model",
        "gemini-2.5-flash",
    ]
    assert runner._build_stdin("Return exactly: OK") == ""


def test_gemini_runner_trusts_workspace_for_headless_mode():
    runner = GeminiRunner()

    assert runner._build_env() == {"GEMINI_CLI_TRUST_WORKSPACE": "true"}


def test_agent_registry_can_instantiate_all_runners():
    registry = AgentRegistry(gemini_model="gemini-2.5-flash")

    assert set(registry.all_names()) == {"gemini", "claude", "codex", "antigravity"}


def test_antigravity_runner_uses_installed_agy_model_ids():
    runner = AntigravityRunner()

    assert runner.default_model == "agy-gemini-3.5-flash-high"
    assert runner.flash_model == "agy-gemini-3.5-flash-medium"
    assert runner.pro_model == "agy-gemini-3.1-pro-high"
    args = runner._build_args_for_prompt(
        "agy-gemini-3.5-flash-medium",
        "Return OK",
    )
    assert args[:3] == [
        "--dangerously-skip-permissions",
        "--prompt",
        "Return OK" + runner._STRICT_SUFFIX,
    ]
    assert args[-2:] == ["--model", "Gemini 3.5 Flash (Medium)"]
    assert runner._build_stdin("Return OK") == ""


def test_codex_runner_uses_isolated_supported_defaults():
    runner = CodexRunner()

    assert runner.default_model == "gpt-5.4-mini"
    assert runner.flash_model == "gpt-5.4-mini"
    assert runner.pro_model == "gpt-5.5"
    assert runner._build_args(runner.default_model) == [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable", "plugins",
        "--disable", "multi_agent",
        "--disable", "apps",
        "--disable", "hooks",
        "--ephemeral",
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--model", "gpt-5.4-mini",
        "-",
    ]
