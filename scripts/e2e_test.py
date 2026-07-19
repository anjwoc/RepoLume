"""
E2E scenario test for RepoLume pipeline.

Canonical verification gate — if this passes, the full wiki generation pipeline works:

  STEP 1  Health check      → GET /health returns 200
  STEP 2  Repo scan         → GET /local_repo/structure returns file_tree
  STEP 3  Structure gen     → POST /chat/completions/stream (async_mode) → SSE complete
  STEP 4  Page gen          → POST /chat/completions/stream (async_mode) → SSE complete (≥50 chars)
  STEP 5  Cache save        → POST /api/wiki_cache returns 200
  STEP 6  Cache verify      → GET  /api/wiki_cache returns saved data

Run after any refactor to confirm correctness:
  poetry -C api run python scripts/e2e_test.py --fast --repo /path/to/repository

Flags:
  --fast  (default) test with 1 page only — ~2 minutes
  --full  test all pages
  --repo  target repo path (default: this RepoLume checkout)

Exit 0 = all checks passed, Exit 1 = failure.
"""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
import httpx

BACKEND = os.environ.get("BACKEND_URL", "http://localhost:8001")
DEFAULT_REPO = os.environ.get("REPOLUME_E2E_REPO", str(Path(__file__).resolve().parents[1]))
STREAM_ID = f"e2e-test-{int(time.time())}"

# ── Helpers ────────────────────────────────────────────────────────────────────

def fail(msg: str) -> None:
    print(f"\n❌ FAIL: {msg}", file=sys.stderr)
    sys.exit(1)

def ok(msg: str) -> None:
    print(f"  ✅ {msg}")

async def sse_collect(
    client: httpx.AsyncClient,
    job_id: str,
    timeout_s: float = 120,
) -> tuple[list[str], str]:
    """Subscribe to SSE stream and return (event_types, accumulated_text)."""
    event_types: list[str] = []
    accumulated: list[str] = []
    deadline = time.monotonic() + timeout_s

    async with client.stream(
        "GET",
        f"{BACKEND}/task-streams/{job_id}/stream",
        headers={"Accept": "text/event-stream"},
        timeout=httpx.Timeout(connect=10.0, read=timeout_s + 30, write=10.0, pool=10.0),
    ) as r:
        if r.status_code != 200:
            fail(f"SSE connect returned HTTP {r.status_code}")
        cur_type = ""
        async for line in r.aiter_lines():
            if time.monotonic() > deadline:
                fail(f"SSE stream timeout after {timeout_s}s — last events: {event_types[-5:]}")
            line = line.strip()
            if not line:
                cur_type = ""
                continue
            if line.startswith("event:"):
                cur_type = line[6:].strip()
                event_types.append(cur_type)
            elif line.startswith("data:"):
                try:
                    data = json.loads(line[5:].strip())
                    if cur_type in ("agent.chunk", "agent_log", "chunk"):
                        text = data.get("data", {}).get("text") or data.get("message") or ""
                        if text:
                            accumulated.append(text)
                    elif cur_type == "error":
                        print(f"  ⚠️  error: {data.get('message', str(data))[:300]}")
                except Exception:
                    pass
            if cur_type in ("complete", "error"):
                break

    return event_types, "".join(accumulated)


async def async_generate(
    client: httpx.AsyncClient,
    payload: dict,
    step_name: str,
    timeout_s: float = 120,
) -> str:
    """POST with async_mode, subscribe to SSE, return accumulated text."""
    payload = {**payload, "async_mode": True, "stream_id": STREAM_ID}
    r = await client.post(
        f"{BACKEND}/chat/completions/stream",
        json=payload,
        timeout=httpx.Timeout(15.0),
    )
    if not r.is_success:
        fail(f"[{step_name}] POST failed HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()
    if "job_id" not in body:
        fail(f"[{step_name}] no job_id in response: {body}")
    job_id = body["job_id"]
    print(f"  → job_id={job_id[:12]}…  (stream {STREAM_ID})")

    events, text = await sse_collect(client, job_id, timeout_s=timeout_s)
    print(f"  → events: {events}")
    if "error" in events:
        fail(f"[{step_name}] error event received")
    if "complete" not in events:
        fail(f"[{step_name}] no complete event. Got: {events}")
    return text


# ── Test Steps ─────────────────────────────────────────────────────────────────

async def step_health() -> None:
    print("\n[STEP 1] Health check")
    async with httpx.AsyncClient(timeout=5.0) as c:
        r = await c.get(f"{BACKEND}/health")
    if r.status_code != 200:
        fail(f"Health check returned {r.status_code}")
    ok(f"Backend healthy — {r.json()['service']}")


async def step_scan_repo(repo: str) -> str:
    print(f"\n[STEP 2] Local repo scan — {repo}")
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{BACKEND}/local_repo/structure", params={"path": repo})
    if r.status_code != 200:
        fail(f"Repo scan failed: {r.status_code} — {r.text[:200]}")
    data = r.json()
    tree = data.get("file_tree", "")
    readme = data.get("readme", "")
    if not tree:
        fail("Repo scan returned empty file_tree")
    ok(f"Scanned {len(tree.splitlines())} files, README={len(readme)} chars")
    return tree[:4000]  # truncate for prompt


async def step_generate_structure(
    client: httpx.AsyncClient, repo: str, file_tree: str, fast: bool
) -> dict:
    print(f"\n[STEP 3] Wiki structure generation (fast={fast})")
    prompt = (
        f"Generate a JSON wiki structure for the project at {repo}.\n\n"
        f"File tree:\n{file_tree}\n\n"
        f"Return ONLY valid JSON with this schema:\n"
        '{"id":"wiki","title":"...","description":"...","pages":[{"id":"p1","title":"...","content":"","filePaths":[],"importance":"high","relatedPages":[]}],"sections":[{"id":"s1","title":"...","pages":["p1"]}],"rootSections":["s1"]}'
        f"\n\n{'Include at most 2 pages for fast test mode.' if fast else ''}"
    )
    payload = {
        "repo_url": repo,
        "type": "local",
        "messages": [{"role": "user", "content": prompt}],
        "provider": "google",
        "language": "ko",
        "skip_rag": True,
        "is_wiki_generation": True,
        "use_cli": True,
        "cli_tool": "gemini",
    }
    raw = await async_generate(client, payload, "structure", timeout_s=180)
    # Extract JSON from markdown code fence if present
    import re
    m = re.search(r"```(?:json)?\n([\s\S]+?)\n```", raw)
    json_str = m.group(1) if m else raw.strip()
    # Try to find JSON object
    start = json_str.find("{")
    end = json_str.rfind("}") + 1
    json_str = json_str[start:end] if start >= 0 else json_str
    try:
        structure = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  Raw response (first 500): {raw[:500]}")
        fail(f"Structure JSON parse failed: {e}")
    pages = structure.get("pages", [])
    ok(f"Structure: {structure.get('title','?')!r} with {len(pages)} pages")
    return structure


async def step_generate_page(
    client: httpx.AsyncClient, repo: str, page: dict
) -> str:
    print(f"\n[STEP 4] Page generation — {page.get('title','?')!r}")
    prompt = (
        f"Write detailed wiki content for the page titled '{page.get('title')}' "
        f"in the project at {repo}. "
        f"Return markdown content only."
    )
    payload = {
        "repo_url": repo,
        "type": "local",
        "messages": [{"role": "user", "content": prompt}],
        "provider": "google",
        "language": "ko",
        "skip_rag": True,
        "is_wiki_generation": True,
        "use_cli": True,
        "cli_tool": "gemini",
    }
    content = await async_generate(client, payload, f"page:{page['id']}", timeout_s=180)
    if len(content) < 50:
        fail(f"Page content too short ({len(content)} chars)")
    ok(f"Page generated: {len(content)} chars")
    return content


async def step_save_cache(
    client: httpx.AsyncClient, repo: str, structure: dict, pages_content: dict
) -> None:
    print("\n[STEP 5] Save wiki cache")
    generated_pages = {}
    for page in structure.get("pages", []):
        pid = page["id"]
        generated_pages[pid] = {
            **page,
            "content": pages_content.get(pid, ""),
        }
    cache_req = {
        "repo": {"owner": "local", "repo": os.path.basename(repo), "type": "local", "localPath": repo},
        "language": "ko",
        "wiki_structure": structure,
        "generated_pages": generated_pages,
        "provider": "google",
    }
    r = await client.post(f"{BACKEND}/api/wiki_cache", json=cache_req, timeout=10.0)
    if not r.is_success:
        fail(f"Cache save failed: {r.status_code} — {r.text[:200]}")
    ok("Wiki cache saved")


async def step_verify_cache(client: httpx.AsyncClient, repo: str) -> None:
    print("\n[STEP 6] Verify wiki cache")
    r = await client.get(
        f"{BACKEND}/api/wiki_cache",
        params={"owner": "local", "repo": os.path.basename(repo), "repo_type": "local", "language": "ko"},
        timeout=10.0,
    )
    if r.status_code == 404 or r.json() is None:
        fail("Wiki cache not found after save")
    data = r.json()
    page_count = len(data.get("generated_pages", {}))
    ok(f"Cache verified: {page_count} pages stored, title={data.get('wiki_structure',{}).get('title','?')!r}")


# ── Main ───────────────────────────────────────────────────────────────────────

async def main(repo: str, fast: bool) -> None:
    print(f"{'='*60}")
    print(f"RepoLume E2E Test — repo={repo}  fast={fast}")
    print(f"Backend: {BACKEND}")
    print(f"{'='*60}")

    await step_health()
    file_tree = await step_scan_repo(repo)

    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
        structure = await step_generate_structure(client, repo, file_tree, fast)

        pages = structure.get("pages", [])
        if fast:
            pages = pages[:1]
            print(f"  [fast mode] Testing with 1 page only")

        pages_content = {}
        for page in pages:
            content = await step_generate_page(client, repo, page)
            pages_content[page["id"]] = content

        await step_save_cache(client, repo, structure, pages_content)
        await step_verify_cache(client, repo)

    print(f"\n{'='*60}")
    print(f"✅ ALL STEPS PASSED — {len(pages)} page(s) generated")
    print(f"{'='*60}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RepoLume E2E test")
    parser.add_argument("--fast", action="store_true", default=True, help="Fast mode: 1 page only")
    parser.add_argument("--full", action="store_true", help="Full mode: all pages")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="Local repo path")
    args = parser.parse_args()
    fast_mode = not args.full

    asyncio.run(main(args.repo, fast_mode))
