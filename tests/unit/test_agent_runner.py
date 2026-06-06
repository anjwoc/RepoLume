from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from api.agent_runner import AgentRegistry, GeminiRunner  # noqa: E402


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
