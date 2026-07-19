"""
RepoLume CLI — main entry point.

Usage examples:
    # Local directory
    python -m cli.wiki generate /path/to/repo --provider gemini --lang ko

    # GitHub URL (will be cloned)
    python -m cli.wiki generate https://github.com/owner/repo --provider claude

    # Custom output directory and parallel workers
    python -m cli.wiki generate ./my-repo --provider openai --output ./wiki-out --workers 4
"""
from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_dotenv() -> None:
    """Load .env from cwd or repolume root if python-dotenv is available."""
    try:
        from dotenv import load_dotenv

        # Try cwd first, then the directory containing this file
        for candidate in [Path.cwd() / ".env", Path(__file__).parent.parent / ".env"]:
            if candidate.is_file():
                load_dotenv(candidate)
                logger.debug(f"Loaded env from {candidate}")
                break
    except ImportError:
        pass


def _print_banner() -> None:
    banner = """
╔══════════════════════════════════════════╗
║        RepoLume — CLI Wiki Generator    ║
║   Powered by repolume (MIT)        ║
╚══════════════════════════════════════════╝
"""
    print(banner)


def _progress_callback(page, index: int, total: int) -> None:
    bar_len = 30
    filled = int(bar_len * index / total)
    bar = "█" * filled + "░" * (bar_len - filled)
    pct = int(100 * index / total)
    sys.stdout.write(f"\r  [{bar}] {pct:3d}% ({index}/{total}) {page.title[:40]:<40}")
    sys.stdout.flush()
    if index == total:
        print()  # newline


# ─────────────────────────────────────────────────────────────────────────────
# Sub-command: generate
# ─────────────────────────────────────────────────────────────────────────────

def cmd_generate(args: argparse.Namespace) -> int:
    _load_dotenv()
    _print_banner()

    # ── 1. Resolve repository ──────────────────────────────────────────────
    from cli.pipeline.local_repo import resolve_repo

    print(f"📂  Resolving repository: {args.repo}")
    tmp_dir = None
    try:
        repo, tmp_dir = resolve_repo(args.repo, clone_dir=args.clone_dir)
    except Exception as exc:
        logger.error(f"Failed to resolve repository: {exc}")
        return 1

    repo_name = args.name or Path(args.repo.rstrip("/")).name

    # ── 2. RepoLume 정적 분석 ─────────────────────
    sonar_collection = None
    if not getattr(args, 'no_sonar', False):
        from cli.sonar.sonar_analyzer import SonarAnalyzer
        print("🔭  RepoLume 정적 분석 시작......")
        try:
            sonar = SonarAnalyzer(str(repo.path))
            sonar_collection = sonar.analyze(use_cache=True)
            diag_count = len(sonar_collection.diagrams)
            node_count = len(sonar_collection.graph.nodes) if sonar_collection.graph else 0
            print(f"✅  Sonar 완료: {node_count}개 노드, {diag_count}개 Mermaid 다이어그램")
        except Exception as exc:
            logger.warning(f"Sonar 분석 건너뜀: {exc}")

    # ── 3. Build graph index (Phase 2) ─────────────────────────────────────
    indexer = None
    if not getattr(args, 'no_index', False):
        from cli.indexer.graph_context import GraphContext
        auto_index = getattr(args, 'auto_index', False)
        indexer = GraphContext(str(repo.path), auto_index=auto_index)
        status = indexer.status()
        active = [k for k, v in status.items() if v]
        if active:
            print(f"⚡  Graph indexers active: {', '.join(active)} (token-efficient mode)")
        else:
            print("ℹ️   No graph index found — using raw file reading (run with --auto-index to build)")

    # ── 4. Create LLM provider ─────────────────────────────────────────────
    from cli.providers import get_provider

    # --agent flag selects CLI subscription mode (no API key)
    # --provider flag selects API-key mode (original repolume)
    agent = getattr(args, 'agent', None)
    if agent:
        provider_name = f"{agent}-cli"  # e.g. "gemini-cli"
        print(f"🤖  Using agent: {agent} (subscription CLI, no API key)")
    else:
        provider_name = args.provider
        print(f"🤖  Using provider: {args.provider}" + (f"/{args.model}" if args.model else ""))

    try:
        provider = get_provider(
            provider_name,
            model=args.model or None,
            cwd=str(repo.path),
        )
    except (ImportError, ValueError) as exc:
        logger.error(f"Provider error: {exc}")
        return 1

    # Build model router for adaptive Flash/Pro selection
    from cli.pipeline.model_router import ModelRouter, ContextSignals
    _agent_name = agent or args.provider
    router = ModelRouter(
        agent=_agent_name,
        model_override=args.model or None,
    )
    model_mode = getattr(args, 'model_mode', 'auto')
    if model_mode == 'flash':
        if hasattr(provider, 'model'):
            provider.model = router.flash_model()
        print(f"⚡  Flash 모드 고정: {router.flash_model()}")
    elif model_mode == 'pro':
        if hasattr(provider, 'model'):
            provider.model = router.pro_model()
        print(f"🚀  Pro 모드 고정: {router.pro_model()}")
    else:
        print(f"🔄  적응형 라우팅: flash={router.flash_model()} / pro={router.pro_model()}")

    # ── 4-B. MCP 컨텍스트 수집 (DB / Jira / GitHub) ────────────────────────
    mcp_manager = None
    mcp_config_path = getattr(args, 'mcp_config', None)
    if not getattr(args, 'no_mcp', False):
        from cli.mcp.manager import MCPManager
        mcp_manager = MCPManager.from_config(mcp_config_path)
        active_sources = {k: v for k, v in mcp_manager.status().items() if v}
        if active_sources:
            print(f"🔌  MCP 소스 활성화: {', '.join(active_sources.keys())}")
        else:
            print("ℹ️   MCP 소스 비활성화 (설정: ~/.repolume/mcp-config.yaml)")

    # ── 5. Plan wiki structure ─────────────────────────────────────────────
    from cli.pipeline.structure_planner import WikiStructurePlanner

    print(f"🗺️   Planning wiki structure (language: {args.lang})…")
    t0 = time.perf_counter()
    try:
        planner = WikiStructurePlanner(provider)
        structure = planner.plan(repo, repo_name=repo_name, lang=args.lang)
    except Exception as exc:
        err = str(exc)
        if "RESOURCE_EXHAUSTED" in err or "429" in err or "quota" in err.lower():
            logger.error(
                "Quota exceeded for this API key.\n"
                "  → Try a paid-tier key, a different model (--model gemini-1.5-pro), "
                "or switch providers (--provider claude / --provider openai)."
            )
        elif "API_KEY" in err or "invalid" in err.lower():
            logger.error(f"Authentication error: {exc}")
        else:
            logger.error(f"Structure planning failed: {exc}")
        return 1

    elapsed = time.perf_counter() - t0
    print(
        f"✅  Structure planned in {elapsed:.1f}s  →  "
        f"{len(structure.sections)} sections, {len(structure.pages)} pages"
    )
    if args.verbose:
        for section in structure.sections:
            print(f"   📁 {section.title}")
            for pid in section.page_ids:
                page = structure.page_by_id(pid)
                if page:
                    print(f"      📄 {page.title} [{page.importance}]")

    # ── 6. Generate pages ──────────────────────────────────────────────────
    from cli.pipeline.page_generator import WikiPageGenerator

    print(f"\n✍️   {len(structure.pages)}개 페이지 생성 (workers={args.workers})…")
    t1 = time.perf_counter()
    try:
        gen = WikiPageGenerator(
            provider, repo, repo_name=repo_name, indexer=indexer,
            sonar_collection=sonar_collection,
            mcp_manager=mcp_manager,
            model_router=router,
        )
        page_contents = gen.generate_all(
            structure,
            lang=args.lang,
            workers=args.workers,
            on_progress=_progress_callback if not args.quiet else None,
        )
    except Exception as exc:
        logger.error(f"Page generation failed: {exc}")
        return 1

    elapsed = time.perf_counter() - t1
    print(f"✅  Pages generated in {elapsed:.1f}s")

    # ── 7. Sonar 다이어그램 주입 ─────────────────────────────────────────
    # NOTE: Sonar diagrams are injected during page generation via WikiPageGenerator.
    # Any pages without diagrams get the overview diagram as fallback.
    sonar_injected = sum(1 for c in page_contents.values() if "\u0060\u0060\u0060mermaid" in c)
    if sonar_injected:
        print(f"🎨  {sonar_injected}개 페이지에 Mermaid 다이어그램 포함")

    # ── 7-B. 비즈니스 분석 레이어 ────────────────────────────────────
    business_analysis = None
    if getattr(args, 'business', False):
        from cli.business import BusinessAnalyzer
        print("\n💼  비즈니스 분석 실행 중...")
        t_biz = time.perf_counter()
        try:
            biz_analyzer = BusinessAnalyzer(provider, repo, repo_name=repo_name)
            business_analysis = biz_analyzer.analyze(lang=args.lang)
            # Inject business analysis pages into page_contents
            page_contents["__business_overview__"] = business_analysis.business_summary_md
            page_contents["__business_dataflow__"] = business_analysis.data_flow_summary_md
            page_contents["__business_workflow__"] = business_analysis.workflow_summary_md
            page_contents["__business_impact__"] = business_analysis.impact_summary_md
            
            # Update structure to show these in the UI
            from cli.pipeline.structure_planner import WikiPage, WikiSection
            
            biz_section = WikiSection(
                id="__section_business__",
                title="Business Analysis" if args.lang != "ko" else "비즈니스 분석",
                page_ids=[
                    "__business_overview__",
                    "__business_dataflow__",
                    "__business_workflow__",
                    "__business_impact__"
                ]
            )
            structure.sections.append(biz_section)
            structure.root_section_ids.append("__section_business__")
            
            structure.pages.extend([
                WikiPage(id="__business_overview__", title="Business Overview", description="", importance="high", file_paths=[], section_id="__section_business__"),
                WikiPage(id="__business_dataflow__", title="Data Flow", description="", importance="high", file_paths=[], section_id="__section_business__"),
                WikiPage(id="__business_workflow__", title="Workflows", description="", importance="high", file_paths=[], section_id="__section_business__"),
                WikiPage(id="__business_impact__", title="Impact Analysis", description="", importance="high", file_paths=[], section_id="__section_business__"),
            ])
            
            elapsed_biz = time.perf_counter() - t_biz
            print(f"✅  비즈니스 분석 완료 ({elapsed_biz:.1f}s)")
        except Exception as exc:
            logger.warning(f"비즈니스 분석 실패 (건너뜀): {exc}")

    # ── 8. Export to disk ──────────────────────────────────────────────────
    from cli.pipeline.file_exporter import FileExporter

    if args.output:
        output = args.output
    else:
        _wiki_out_root = Path("./wiki-out")
        _base = repo_name
        _idx = next(
            (i for i in range(1, 100)
             if not (_wiki_out_root / f"{_base}_{i:02d}").exists()),
            99,
        )
        output = str(_wiki_out_root / f"{_base}_{_idx:02d}")
    print(f"\n💾  Exporting wiki to: {output}")
    try:
        exporter = FileExporter(output)
        out_path = exporter.export(structure, page_contents)
    except Exception as exc:
        logger.error(f"Export failed: {exc}")
        return 1

    # ── 6. Summary ─────────────────────────────────────────────────────────
    total_elapsed = time.perf_counter() - t0
    md_files = list(out_path.rglob("*.md"))
    print(f"""
╔══════════════════════════════════════════╗
║              ✅ Wiki Generated!           ║
╠══════════════════════════════════════════╣
║  Repository : {repo_name:<26} ║
║  Pages      : {len(md_files):<26} ║
║  Output     : {str(out_path):<26} ║
║  Time       : {total_elapsed:<25.1f}s ║
╚══════════════════════════════════════════╝

Open your wiki:  cat {out_path}/README.md
""")

    # ── Cleanup cloned temp dir ────────────────────────────────────────────
    if tmp_dir and not args.keep_clone:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Sub-command: plan (structure preview only, no page generation)
# ─────────────────────────────────────────────────────────────────────────────

def cmd_plan(args: argparse.Namespace) -> int:
    """Preview the wiki structure without generating page content."""
    _load_dotenv()

    from cli.pipeline.local_repo import resolve_repo
    from cli.pipeline.structure_planner import WikiStructurePlanner
    from cli.providers import get_provider
    import json

    repo, tmp_dir = resolve_repo(args.repo)
    repo_name = args.name or Path(args.repo.rstrip("/")).name

    agent = getattr(args, 'agent', None)
    provider_name = f"{agent}-cli" if agent else args.provider
    provider = get_provider(provider_name, model=args.model or None, cwd=str(repo.path))

    planner = WikiStructurePlanner(provider)
    structure = planner.plan(repo, repo_name=repo_name, lang=args.lang)

    print(f"\n📋 Wiki Structure: {structure.title}")
    print(f"   {structure.description}\n")
    for section in structure.sections:
        print(f"  📁  {section.title}")
        for pid in section.page_ids:
            page = structure.page_by_id(pid)
            if page:
                badge = {"high": "⭐", "medium": "📄", "low": "📎"}.get(page.importance, "📄")
                print(f"      {badge} {page.title}")
                if args.verbose and page.file_paths:
                    for fp in page.file_paths[:3]:
                        print(f"           {fp}")

    if tmp_dir:
        shutil.rmtree(tmp_dir, ignore_errors=True)
    return 0


# ─────────────────────────────────────────────────────────────────────────────
# Argument parser
# ─────────────────────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="wiki",
        description="RepoLume — Generate RepoLume-style docs locally with Gemini/Claude/OpenAI",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── generate ──
    gen = sub.add_parser("generate", aliases=["gen", "g"], help="Generate full wiki")
    gen.add_argument("repo", help="Local path or git URL of the repository")
    gen.add_argument(
        "--provider", "-p",
        default=os.environ.get("WIKI_PROVIDER", "gemini"),
        choices=["gemini", "claude", "openai", "codex",
                 "gemini-cli", "codex-cli", "claude-cli"],
        help="LLM provider: API-key (gemini, claude, openai) or CLI sub (gemini-cli, codex-cli, claude-cli)",
    )
    gen.add_argument(
        "--agent", "-a",
        default=None,
        choices=["gemini", "codex", "claude"],
        help="Shortcut for CLI subscription mode (equivalent to --provider gemini-cli etc.)",
    )
    gen.add_argument("--model", "-m", default=None, help="Model name override")
    gen.add_argument(
        "--model-mode",
        default="auto",
        choices=["auto", "flash", "pro"],
        help="auto=adaptive routing, flash=always lightweight, pro=always high-quality",
    )
    gen.add_argument("--output", "-o", default=None, help="Output directory")
    gen.add_argument("--lang", "-l", default="en", help="Language code (en, ko, ja, zh …)")
    gen.add_argument("--workers", "-w", type=int, default=1, help="Parallel page workers")
    gen.add_argument("--name", default=None, help="Repository display name override")
    gen.add_argument("--clone-dir", default=None, help="Directory to clone into (default: temp)")
    gen.add_argument("--keep-clone", action="store_true", help="Don't delete cloned temp dir")
    gen.add_argument("--verbose", "-v", action="store_true")
    gen.add_argument("--quiet", "-q", action="store_true")
    gen.add_argument("--no-sonar", action="store_true",
                     help="RepoLume 정적 분석 건너뜀")
    gen.add_argument("--no-index", action="store_true",
                     help="Skip graph index (use raw file reading only)")
    gen.add_argument("--auto-index", action="store_true",
                     help="Auto-build codegraph/graphify index if missing")
    gen.add_argument("--no-mcp", action="store_true",
                     help="MCP 소스 비활성화 (빠른 실행 용도)")
    gen.add_argument("--mcp-config", default=None, metavar="PATH",
                     help="MCP 설정 파일 (default: ~/.repolume/mcp-config.yaml)")
    gen.add_argument(
        "--business", "-B", action="store_true",
        help="비즈니스 분석 레이어 활성화 (데이터 플로우, 워크플로우, 임팩트 분석)"
    )
    gen.set_defaults(func=cmd_generate)

    # ── plan ──
    plan = sub.add_parser("plan", help="Preview wiki structure without generating pages")
    plan.add_argument("repo", help="Local path or git URL")
    plan.add_argument(
        "--provider", "-p",
        default=os.environ.get("WIKI_PROVIDER", "gemini"),
        choices=["gemini", "claude", "openai", "codex",
                 "gemini-cli", "codex-cli", "claude-cli"],
    )
    plan.add_argument(
        "--agent", "-a",
        default=None,
        choices=["gemini", "codex", "claude"],
        help="CLI subscription mode shortcut",
    )
    plan.add_argument("--model", "-m", default=None)
    plan.add_argument("--lang", "-l", default="en")
    plan.add_argument("--name", default=None)
    plan.add_argument("--verbose", "-v", action="store_true")
    plan.set_defaults(func=cmd_plan)

    # ── publish ──
    pub = sub.add_parser("publish", help="Publish generated wiki to Confluence")
    pub.add_argument("dir", help="Directory containing generated markdown files (e.g. wiki-out/repolume)")
    pub.add_argument("--url", required=True, help="Confluence Base URL (e.g. https://your-domain.atlassian.net/wiki)")
    pub.add_argument("--space", required=True, help="Confluence Space Key")
    pub.add_argument("--token", required=True, help="API Token or PAT")
    pub.add_argument("--username", default=None, help="Email/username (required for Atlassian Cloud)")
    pub.add_argument("--root-title", default="RepoLume Export", help="Title of the root index page")
    pub.add_argument("--parent-id", default=None, help="Optional parent page ID to attach the root index to")
    pub.set_defaults(func=cmd_publish)

    return parser

def cmd_publish(args: argparse.Namespace) -> int:
    from cli.pipeline.publisher import ConfluencePublisher
    from pathlib import Path
    
    root_dir = Path(args.dir)
    if not root_dir.is_dir():
        print(f"❌ Error: {root_dir} is not a valid directory.")
        return 1
        
    print(f"🚀 Publishing wiki from {root_dir} to Confluence space '{args.space}'...")
    try:
        publisher = ConfluencePublisher(
            base_url=args.url,
            space_key=args.space,
            auth_token=args.token,
            username=args.username
        )
        publisher.publish_directory(root_dir, root_title=args.root_title, root_parent_id=args.parent_id)
        print("✅ Publish complete!")
    except Exception as e:
        print(f"❌ Publish failed: {e}")
        return 1
    return 0


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))


if __name__ == "__main__":
    main()
