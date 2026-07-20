"""Benchmark result API — list runs and serve per-provider output."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

BENCHMARK_DIR = Path(__file__).parent.parent.parent / "benchmark-out"

router = APIRouter(prefix="/api/benchmark", tags=["benchmark"])


def _run_dir(timestamp: str) -> Path:
    p = BENCHMARK_DIR / timestamp
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Run not found: {timestamp}")
    return p


@router.get("/runs")
def list_runs():
    """Return all benchmark run timestamps, newest first."""
    if not BENCHMARK_DIR.exists():
        return []
    runs = sorted(
        [d.name for d in BENCHMARK_DIR.iterdir() if d.is_dir()],
        reverse=True,
    )
    result = []
    for ts in runs:
        report_path = BENCHMARK_DIR / ts / "report.json"
        if not report_path.exists():
            continue
        try:
            data = json.loads(report_path.read_text(encoding="utf-8"))
            result.append({
                "timestamp": ts,
                "repo": data.get("repo", ""),
                "module": data.get("module", ""),
                "results": data.get("results", []),
            })
        except Exception:
            result.append({"timestamp": ts, "repo": "", "module": "", "results": []})
    return result


@router.get("/runs/{timestamp}")
def get_run(timestamp: str):
    """Return the full report.json for a specific run."""
    p = _run_dir(timestamp) / "report.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="report.json missing")
    return json.loads(p.read_text(encoding="utf-8"))


@router.get("/runs/{timestamp}/content")
def get_provider_content(timestamp: str, provider: str = Query(...)):
    """Return the markdown content for a specific provider in a run.

    Provider names with '/' are supported (e.g. openrouter/deepseek-v4-flash)
    because the filename is derived by replacing '/' with '_'.
    """
    run = _run_dir(timestamp)
    fname = provider.replace("/", "_") + ".md"
    p = run / fname
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"Content not found for provider: {provider}")
    return {"content": p.read_text(encoding="utf-8")}
