#!/usr/bin/env python3
"""
Benchmark: same complex module → all available providers → compare output quality.

Usage:
  pnpm benchmark
  python scripts/benchmark.py --repo ~/lab/vscode --module src/vs/editor/common/model/textModel.ts
  python scripts/benchmark.py --openrouter-model anthropic/claude-haiku-3-5

Saves to: benchmark-out/YYYYMMDD_HHMMSS/
  {provider}.md   — generated wiki page
  report.md       — comparison table + previews
  report.json     — machine-readable results
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from api.agent_runner import AgentRegistry

# ── Constants ─────────────────────────────────────────────────────────────────

OPENROUTER_TOP_MODELS = [
    "deepseek/deepseek-v4-flash",
    "google/gemini-flash-1.5",
    "anthropic/claude-haiku-3-5",
    "openai/gpt-4o-mini",
    "deepseek/deepseek-r1-0528",
    "google/gemini-2.5-flash",
    "openai/gpt-4.1-mini",
    "meta-llama/llama-3.3-70b-instruct",
    "mistralai/mistral-small-3.1-24b-instruct",
    "nousresearch/hermes-3-llama-3.1-405b",
]
DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-v4-flash"
MODULE_CONTENT_LIMIT = 8000  # chars

SOURCE_EXTENSIONS = {".ts", ".tsx", ".py", ".rs", ".go", ".java", ".kt", ".swift"}
SKIP_SUFFIXES = {".d.ts"}  # type declarations only, no implementation
SKIP_DIRS = {"node_modules", ".git", "dist", "out", ".next", "__pycache__", "vendor", "target",
             "fixtures", "colorize-perf", "test-fixture", "colorize-fixtures", "testFixtures",
             "grammars", "languages", "l10n", "nls", "i18n", "syntaxes"}
# Exact directory segment names to skip (test infra, not production code)
SKIP_DIR_SEGMENTS = {"test", "tests", "__tests__", "spec", "specs", "mocks", "stubs"}
# File name patterns to skip
SKIP_NAME_PATTERNS = [".perf-data.", ".test-data.", ".bench.", ".fixture.",
                      ".tmLanguage.", ".tmGrammar.", ".monarch."]
# Code-like keywords — a file needs at least N matching lines to count as real source
CODE_KEYWORDS = ("function ", "class ", "def ", "fn ", "impl ", "interface ", "export ", "import ")
MIN_CODE_LINES = 5


# ── Module selection ───────────────────────────────────────────────────────────

def find_large_source_files(repo: Path, top_n: int = 5) -> list[tuple[int, Path]]:
    """Return the top_n largest source files sorted by size descending."""
    candidates: list[tuple[int, Path]] = []
    for path in repo.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if any(part in SKIP_DIR_SEGMENTS for part in path.parts):
            continue
        if any(pat in path.name for pat in SKIP_NAME_PATTERNS):
            continue
        if any(path.name.endswith(s) for s in SKIP_SUFFIXES):
            continue
        if path.suffix in SOURCE_EXTENSIONS and path.is_file():
            try:
                size = path.stat().st_size
                if size < 10_000:  # skip tiny files
                    continue
                # Quick sanity check: file must have actual code lines
                sample = path.read_text(encoding="utf-8", errors="replace")[:4000]
                code_lines = sum(1 for l in sample.splitlines() if any(k in l for k in CODE_KEYWORDS))
                if code_lines < MIN_CODE_LINES:
                    continue
                candidates.append((size, path))
            except OSError:
                pass
    candidates.sort(reverse=True)
    return candidates[:top_n]


def pick_module(repo: Path, module_path: str | None) -> Path:
    if module_path:
        p = Path(module_path)
        if not p.is_absolute():
            p = repo / p
        if not p.exists():
            print(f"❌ Module not found: {p}", file=sys.stderr)
            sys.exit(1)
        return p

    files = find_large_source_files(repo)
    if not files:
        print("❌ No source files found in repo", file=sys.stderr)
        sys.exit(1)

    print("\n📂 복잡한 모듈 선택 (자동 감지 — 가장 큰 소스 파일 Top 5):")
    for i, (size, path) in enumerate(files):
        rel = path.relative_to(repo)
        print(f"  [{i+1}] {rel}  ({size // 1024}KB)")
    print(f"  [Enter] 자동 선택 (1번)")

    choice = input("\n선택 (번호): ").strip()
    idx = 0
    if choice.isdigit():
        idx = max(0, min(int(choice) - 1, len(files) - 1))
    return files[idx][1]


def pick_openrouter_model(default: str) -> str:
    if default != DEFAULT_OPENROUTER_MODEL:
        return default  # explicitly passed via --openrouter-model

    print("\n🤖 OpenRouter 모델 선택:")
    for i, m in enumerate(OPENROUTER_TOP_MODELS):
        marker = " ← 기본값" if m == DEFAULT_OPENROUTER_MODEL else ""
        print(f"  [{i+1}] {m}{marker}")
    print(f"  [Enter] 기본값 사용 ({DEFAULT_OPENROUTER_MODEL})")

    choice = input("\n선택 (번호): ").strip()
    if choice.isdigit():
        idx = max(0, min(int(choice) - 1, len(OPENROUTER_TOP_MODELS) - 1))
        return OPENROUTER_TOP_MODELS[idx]
    return DEFAULT_OPENROUTER_MODEL


# ── Prompt builder ─────────────────────────────────────────────────────────────

def build_prompt(module_path: Path, repo: Path, content: str) -> str:
    try:
        rel = module_path.relative_to(repo)
    except ValueError:
        rel = module_path
    return f"""/no_think

You are writing technical wiki documentation.

Module: `{rel}`

Source code:
```
{content}
```

Write a comprehensive wiki page (Markdown) covering:
- What this module does and its purpose
- Key classes, functions, and their responsibilities
- Important patterns or design decisions
- How this module fits into the larger project

Output ONLY the Markdown content. No preamble, no explanation — just the wiki page.
"""


# ── OpenRouter direct call ─────────────────────────────────────────────────────

async def openrouter_generate(model: str, prompt: str, api_key: str) -> tuple[str, str]:
    """Returns (content, error). Uses aiohttp directly."""
    import aiohttp

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://localwiki.dev",
        "X-Title": "LocalWiki Benchmark",
    }
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=body,
                timeout=aiohttp.ClientTimeout(total=120),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    return "", f"HTTP {resp.status}: {text[:200]}"
                data = await resp.json()
                content = data["choices"][0]["message"]["content"]
                return content, ""
    except Exception as e:
        return "", str(e)


# ── Run one provider ───────────────────────────────────────────────────────────

async def run_cli(name: str, runner, prompt: str, repo: Path, sem: asyncio.Semaphore) -> dict:
    async with sem:
        if not runner.available():
            return {"provider": name, "status": "SKIPPED", "error": "binary not found",
                    "content": "", "duration_s": 0}
        t0 = time.monotonic()
        try:
            result = await runner.run_collect(prompt, cwd=str(repo), timeout=120)
        except OSError as e:
            return {"provider": name, "status": "SKIPPED",
                    "error": f"binary not executable: {e.strerror}",
                    "content": "", "duration_s": round(time.monotonic() - t0, 1)}
        duration = round(time.monotonic() - t0, 1)
        if result.error:
            err_str = result.error.strip()
            # ENOEXEC — binary exists but is a stub/wrapper
            if "Exec format error" in err_str or "[Errno 8]" in err_str:
                return {"provider": name, "status": "SKIPPED",
                        "error": "binary not executable (stub or wrong arch)",
                        "content": "", "duration_s": duration}
            # Trim long errors (codex dumps full prompt to stderr)
            lines = err_str.splitlines()
            short_err = next((l for l in reversed(lines) if l.strip()), err_str)
            short_err = short_err[:200]
            return {"provider": name, "status": "ERROR", "error": short_err,
                    "content": result.content, "duration_s": duration}
        return {"provider": name, "status": "OK", "error": "",
                "content": result.content, "duration_s": duration}


async def run_openrouter(model: str, prompt: str, api_key: str) -> dict:
    provider = f"openrouter/{model.split('/')[-1]}"
    if not api_key:
        return {"provider": provider, "status": "SKIPPED", "error": "OPENROUTER_API_KEY not set",
                "content": "", "duration_s": 0}
    t0 = time.monotonic()
    content, error = await openrouter_generate(model, prompt, api_key)
    duration = round(time.monotonic() - t0, 1)
    if error:
        return {"provider": provider, "status": "ERROR", "error": error,
                "content": content, "duration_s": duration}
    return {"provider": provider, "status": "OK", "error": "",
            "content": content, "duration_s": duration}


# ── Report generation ──────────────────────────────────────────────────────────

def status_icon(s: str) -> str:
    return {"OK": "✅", "ERROR": "❌", "SKIPPED": "⏭"}.get(s, "?")


def make_report_md(results: list[dict], repo: Path, module: Path, timestamp: str) -> str:
    try:
        rel_module = module.relative_to(repo)
    except ValueError:
        rel_module = module

    lines = [
        f"# Benchmark Report — {timestamp}",
        f"",
        f"**Repo:** `{repo}`  ",
        f"**Module:** `{rel_module}`  ",
        f"**Run at:** {timestamp}",
        f"",
        "## Summary",
        "",
        "| Provider | Status | Duration | Chars |",
        "|----------|--------|----------|-------|",
    ]
    for r in results:
        icon = status_icon(r["status"])
        chars = len(r["content"]) if r["content"] else 0
        dur = f"{r['duration_s']}s" if r["duration_s"] else "-"
        lines.append(f"| {r['provider']} | {icon} {r['status']} | {dur} | {chars:,} |")

    lines += ["", "## Output Previews", ""]
    for r in results:
        lines.append(f"### {r['provider']} ({status_icon(r['status'])} {r['status']})")
        if r["status"] == "SKIPPED":
            lines.append(f"> {r['error']}\n")
        elif r["status"] == "ERROR":
            lines.append(f"> ❌ {r['error']}\n")
        else:
            preview = (r["content"] or "")[:600].replace("```", "` ` `")
            lines.append(f"```markdown\n{preview}\n...\n```\n")

    return "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────────────────

async def run_benchmark(repo: Path, module: Path, openrouter_model: str) -> list[dict]:
    content = module.read_text(encoding="utf-8", errors="replace")
    if len(content) > MODULE_CONTENT_LIMIT:
        content = content[:MODULE_CONTENT_LIMIT] + "\n\n[... truncated ...]"

    prompt = build_prompt(module, repo, content)

    # Suppress verbose agent runner logs during benchmark
    import logging as _logging
    _logging.getLogger("api.agent_runner").setLevel(_logging.CRITICAL)

    registry = AgentRegistry()
    sem = asyncio.Semaphore(3)  # max 3 concurrent CLI processes

    cli_names = ["gemini", "claude", "codex", "antigravity"]
    cli_tasks = [
        run_cli(name, registry.get(name), prompt, repo, sem)
        for name in cli_names
    ]

    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    api_task = run_openrouter(openrouter_model, prompt, api_key)

    all_results = await asyncio.gather(*cli_tasks, api_task)
    return list(all_results)


def save_results(results: list[dict], out_dir: Path, repo: Path, module: Path, timestamp: str) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    for r in results:
        if r["content"]:
            fname = r["provider"].replace("/", "_") + ".md"
            (out_dir / fname).write_text(r["content"], encoding="utf-8")

    report_md = make_report_md(results, repo, module, timestamp)
    (out_dir / "report.md").write_text(report_md, encoding="utf-8")

    report_json = {
        "timestamp": timestamp,
        "repo": str(repo),
        "module": str(module),
        "results": [
            {k: v for k, v in r.items() if k != "content"}
            for r in results
        ],
    }
    (out_dir / "report.json").write_text(
        json.dumps(report_json, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def print_summary(results: list[dict], out_dir: Path) -> None:
    print(f"\n{'='*60}")
    print("Benchmark Results")
    print(f"{'='*60}")
    for r in results:
        icon = status_icon(r["status"])
        chars = f"{len(r['content']):,}" if r["content"] else "0"
        dur = f"{r['duration_s']}s" if r["duration_s"] else " -"
        err = f"  ← {r['error']}" if r["error"] else ""
        print(f"  {icon} {r['provider']:<30} {dur:>6}  {chars:>7} chars{err}")
    print(f"\n📁 Saved to: {out_dir}")
    print(f"   report.md   — full comparison")
    print(f"{'='*60}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="LocalWiki benchmark — compare provider quality")
    parser.add_argument("--repo", default=str(Path.home() / "lab/vscode"), help="Target repo path")
    parser.add_argument("--module", default=None, help="Source file to document (auto-detect if omitted)")
    parser.add_argument("--openrouter-model", default=DEFAULT_OPENROUTER_MODEL,
                        help=f"OpenRouter model (default: {DEFAULT_OPENROUTER_MODEL})")
    parser.add_argument("--out", default=str(ROOT / "benchmark-out"), help="Output base directory")
    parser.add_argument("--auto", action="store_true", help="Skip interactive prompts, use defaults")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    if not repo.exists():
        print(f"❌ Repo not found: {repo}", file=sys.stderr)
        sys.exit(1)

    print(f"\n🔬 LocalWiki Benchmark")
    print(f"   Repo: {repo}")

    # Module selection
    if args.auto:
        files = find_large_source_files(repo)
        if not files:
            print("❌ No source files found", file=sys.stderr)
            sys.exit(1)
        module = files[0][1]
        print(f"   Module (auto): {module.relative_to(repo)}")
    else:
        module = pick_module(repo, args.module)

    print(f"   Module: {module.relative_to(repo)} ({module.stat().st_size // 1024}KB)")

    # OpenRouter model selection
    if args.auto:
        openrouter_model = args.openrouter_model
    else:
        openrouter_model = pick_openrouter_model(args.openrouter_model)

    print(f"   OpenRouter: {openrouter_model}")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.out) / timestamp

    print(f"\n🚀 Running {4 + 1} providers in parallel...\n")

    results = asyncio.run(run_benchmark(repo, module, openrouter_model))
    save_results(results, out_dir, repo, module, timestamp)
    print_summary(results, out_dir)


if __name__ == "__main__":
    main()
