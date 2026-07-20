"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, startTransition, memo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search, Moon, Sun, ChevronRight,
  FileText, Folder, FolderOpen, X, Home,
  AlignCenter, AlignJustify, RefreshCw, Share, Sparkles, ArrowUp, Link, FlaskConical,
} from "lucide-react";
import { getTheme } from "@/lib/theme";
import { slugifyHeading } from "@/lib/utils";
import Markdown from "./Markdown";
import { sanitizeMermaidChart } from "./Mermaid";
import { regenerateWikiPage, wikiLanguageInstruction } from "@/lib/wiki-generator";
import { WikiAskPanel } from "./WikiAskPanel";
import { FaGithub } from "react-icons/fa";
import { TestScenarioViewer } from "./TestScenarioViewer";
import type { TestGenProgress } from "@/lib/test-scenario-types";
import type { DiagramEdgeData } from "@/lib/diagram-edge-types";
import { manifestToViewerScenarios } from "@/lib/scenario-manifest";
import type { GitRoot } from "@/lib/source-link-resolver";
import type { PipelineEvent } from "@/lib/taskStreamClient";
import { RepoLumeMark } from "@/components/repolume-mark";


const APP_SETTINGS_KEY = "repolume_app_settings";

interface ProjectData {
  owner: string;
  repo: string;
  repo_type: string;
  language: string;
  languages?: string[];
  model?: string;
  id?: string;
}

interface WikiViewerProps {
  isDark: boolean;
  onToggleTheme: () => void;
  projectName: string;
  projectData: ProjectData | null;
  onGoHome: () => void;
  repositoryBaseUrl?: string;
  hoverBgColor?: string;
  initialPageId?: string;
}

interface TreeItem {
  id: string;
  title: string;
  icon: "file" | "folder";
  children?: TreeItem[];
}

function formatDisplayTitle(title: string): string {
  if (!title) return title;
  // kebab-case → "Title Case" (primary format going forward)
  if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(title)) {
    return title.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // snake_case → "Title Case" (legacy)
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(title)) {
    return title.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // camelCase / PascalCase → "Title Case With Spaces" (legacy)
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(title) && /[A-Z]/.test(title)) {
    return title
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase());
  }
  // plain lowercase word → capitalize first letter
  if (/^[a-z]/.test(title)) {
    return title.charAt(0).toUpperCase() + title.slice(1);
  }
  return title;
}

interface WikiSection {
  id: string;
  title: string;
  pages: string[];
  subsections?: string[];
}

interface WikiPage {
  id: string;
  title: string;
  content: string;
  filePaths: string[];
  importance?: string;
  relatedPages?: string[];
}

interface WikiStructure {
  id: string;
  title: string;
  pages: WikiPage[];
  sections: WikiSection[];
  rootSections: string[];
}

const isShowcase = process.env.NEXT_PUBLIC_SHOWCASE_MODE === 'true';

// ── TocPanel ─────────────────────────────────────────────────────────────────
// Isolated component — owns tocOpen/activeTocIdx state entirely.
// isDark (boolean, primitive) passed instead of t (object ref) to prevent
// React.memo from re-rendering on every WikiViewer render.
interface TocHeading { level: number; text: string; domIdx: number; slug: string; }
interface TocPanelProps {
  headings: TocHeading[];
  contentRef: React.RefObject<HTMLDivElement | null>;
  selectedPage: string;
  isDark: boolean;
}

const TocPanel = memo(function TocPanel({ headings, contentRef, selectedPage, isDark }: TocPanelProps) {
  // Compute theme inside the component so the object stays local — never leaks as a prop.
  const t = useMemo(() => getTheme(isDark), [isDark]);

  const [tocOpen, setTocOpen] = useState(false);
  const [activeTocIdx, setActiveTocIdx] = useState(-1);

  useEffect(() => {
    setActiveTocIdx(-1);
    const container = contentRef.current;
    if (!container || headings.length === 0) return;
    const handleScroll = () => {
      const els = container.querySelectorAll('h1, h2, h3');
      const containerTop = container.getBoundingClientRect().top;
      let active = -1;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top - containerTop <= 96) active = i;
      });
      // Near bottom: snap to last heading so it's never stuck in the middle.
      const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
      if (nearBottom && els.length > 0) active = els.length - 1;
      setActiveTocIdx(active);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [selectedPage, headings, contentRef]);

  const scrollToHeadingByIdx = useCallback((domIdx: number, slug: string) => {
    const container = contentRef.current;
    if (!container) return;
    const el = container.querySelectorAll('h1, h2, h3')[domIdx] as HTMLElement | undefined;
    if (!el) return;
    const offset = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 80;
    container.scrollTo({ top: offset, behavior: 'smooth' });
    if (slug) {
      window.history.replaceState(null, '',
        `${window.location.pathname}${window.location.search}#${slug}`);
    }
  }, [contentRef]);

  if (headings.length === 0) return null;

  // Notion-style: hover zone covers the full right strip so the panel stays
  // open while the user reads/clicks items.
  return (
    <div
      onMouseEnter={() => setTocOpen(true)}
      onMouseLeave={() => setTocOpen(false)}
      style={{ position: "fixed", right: 0, top: 52, bottom: 0, width: 24, zIndex: 30 }}
    >
      {/* Sliding ToC panel */}
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 224,
        transform: `translateX(${tocOpen ? 0 : 225}px)`,
        transition: "transform 0.18s cubic-bezier(0.4,0,0.2,1)",
        background: isDark ? "rgba(15,15,18,0.96)" : "rgba(251,251,253,0.97)",
        backdropFilter: "blur(12px)",
        borderLeft: `1px solid ${isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)"}`,
        display: "flex", flexDirection: "column",
        overflowY: "auto", overflowX: "hidden",
        paddingBottom: 24,
      }}>
        {/* "ON THIS PAGE" label — Notion style */}
        <div style={{
          padding: "18px 16px 8px",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: isDark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.28)",
          flexShrink: 0,
          userSelect: "none",
        }}>
          On this page
        </div>

        {headings.map((h, i) => {
          const isActive = activeTocIdx === i;
          const indent = (h.level - 1) * 12;
          return (
            <button
              key={h.domIdx}
              onClick={() => scrollToHeadingByIdx(h.domIdx, h.slug)}
              title={h.text}
              style={{
                display: "block",
                textAlign: "left",
                background: isActive
                  ? (isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)")
                  : "none",
                border: "none",
                cursor: "pointer",
                padding: `4px 12px 4px ${16 + indent}px`,
                fontSize: 12.5,
                fontWeight: isActive ? 500 : 400,
                color: isActive
                  ? (isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.88)")
                  : (isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.44)"),
                lineHeight: 1.55,
                fontFamily: "inherit",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                borderRadius: 4,
                margin: "0 6px",
                width: "calc(100% - 12px)",
                boxSizing: "border-box",
                transition: "background 0.1s, color 0.1s",
                // Notion-style: subtle left accent only on active
                boxShadow: isActive
                  ? `inset 2px 0 0 ${isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)"}`
                  : "none",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!isActive) {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)";
                  el.style.color = isDark ? "rgba(255,255,255,0.65)" : "rgba(0,0,0,0.65)";
                }
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                if (!isActive) {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = "none";
                  el.style.color = isDark ? "rgba(255,255,255,0.44)" : "rgba(0,0,0,0.44)";
                }
              }}
            >
              {h.text}
            </button>
          );
        })}
      </div>

      {/* Collapsed state — minimap-style bar indicators */}
      {!tocOpen && (
        <div style={{
          position: "absolute",
          right: 0, top: 0, bottom: 0, width: 24,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          paddingTop: 48, paddingBottom: 48, gap: 3.5,
        }}>
          {headings.map((h, i) => {
            const isActive = activeTocIdx === i;
            return (
              <div
                key={h.domIdx}
                onClick={() => scrollToHeadingByIdx(h.domIdx, h.slug)}
                style={{
                  width: isActive ? 12 : 8,
                  height: 1.5,
                  borderRadius: 999,
                  flexShrink: 0,
                  cursor: "pointer",
                  transition: "width 0.18s ease, background 0.18s ease",
                  background: isActive
                    ? (isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.58)")
                    : (isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.13)"),
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
});

export function WikiViewer({ isDark, onToggleTheme, projectName, projectData, onGoHome, repositoryBaseUrl, hoverBgColor, initialPageId }: WikiViewerProps) {
  const t = getTheme(isDark);
  const [selectedPage, setSelectedPage] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [readingMode, setReadingMode] = useState(true); // 기본값: 읽기 모드 (노션처럼)
  const [showAsk, setShowAsk] = useState(false); // "위키에 질문하기" 우측 패널
  const [repoPath, setRepoPath] = useState(""); // 원본 레포 로컬 경로 (소스 기반 질의용)
  const [artifactRoot, setArtifactRoot] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const savedSidebarScrollRef = useRef(0);
  const selectedPageRef = useRef("");
  // Tracks which page should be (re-)selected after loadWiki runs.
  // Seeded from the URL ?page= param; updated on every navigate() call.
  const intentionalPageRef = useRef<string | undefined>(initialPageId);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const currentLang = projectData?.language || "ko";

  // Dynamic state from backend
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [allPages, setAllPages] = useState<TreeItem[]>([]);
  const [generatedPages, setGeneratedPages] = useState<Record<string, WikiPage>>({});
  const [wikiStructure, setWikiStructure] = useState<WikiStructure | null>(null);

  // Regeneration state
  const [localLoadingPages, setLocalLoadingPages] = useState<Record<string, boolean>>({});
  const isRegenerating = selectedPage ? !!localLoadingPages[selectedPage] : false;
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [brokenDiagrams, setBrokenDiagrams] = useState<{pageId: string, chartCode: string}[]>([]);
  const [isBatchFixing, setIsBatchFixing] = useState(false);
  const [batchFixProgress, setBatchFixProgress] = useState({ current: 0, total: 0 });
  // Per-subproject git roots (each dir with its own .git) used to build GitHub
  // links rooted at the individual repository instead of the bundling parent.
  // null = still loading (don't generate any GitHub links yet); [] = loaded but no roots
  const [gitRoots, setGitRoots] = useState<GitRoot[] | null>(null);
  const [isResyncingLinks, setIsResyncingLinks] = useState(false);
  const [resyncResult, setResyncResult] = useState<{ links_fixed: number } | null>(null);
  // Per-project GitHub URL override (persisted in localStorage, editable by user).
  const githubUrlStorageKey = projectData ? `repolume_github_url_${projectData.owner}_${projectData.repo}` : null;
  const [customGithubUrl, setCustomGithubUrl] = useState<string>(() => {
    if (!projectData) return '';
    try { return localStorage.getItem(`repolume_github_url_${projectData.owner}_${projectData.repo}`) || ''; } catch { return ''; }
  });
  // Auto-detected URL (from git remote / cached JSON) — not user-editable, used as fallback
  const [autoDetectedGithubUrl, setAutoDetectedGithubUrl] = useState<string>('');
  // Model/provider used to generate this wiki (shown in header)
  const [wikiModel, setWikiModel] = useState<string>('');
  const [showGithubUrlEdit, setShowGithubUrlEdit] = useState(false);
  const [githubUrlDraft, setGithubUrlDraft] = useState('');
  // Section(directory)-level regeneration + business-analysis generation.
  const [refreshKey, setRefreshKey] = useState(0);
  const [regeneratingSectionId, setRegeneratingSectionId] = useState<string | null>(null);
  const [sectionRegenProgress, setSectionRegenProgress] = useState({ current: 0, total: 0 });
  const [isGeneratingBusiness, setIsGeneratingBusiness] = useState(false);
  const [showTestScenarios, setShowTestScenarios] = useState(false);
  const [testGenProgress, setTestGenProgress] = useState<TestGenProgress | null>(null);
  const [testScenarioResults, setTestScenarioResults] = useState<any[]>([]);
  const [diagramEdgeData, setDiagramEdgeData] = useState<DiagramEdgeData | null>(null);
  // Cache fetched edge data to avoid repeated network calls: flowId → data|null
  const edgeDataCacheRef = useRef<Map<string, DiagramEdgeData | null>>(new Map());
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const [isBulkRegening, setIsBulkRegening] = useState(false);
  const [bulkRegenProgress, setBulkRegenProgress] = useState({ current: 0, total: 0 });
  const regenPromptRef = useRef<HTMLTextAreaElement>(null);

  // Fetch diagram edge data when selected page changes
  useEffect(() => {
    if (!selectedPage) { setDiagramEdgeData(null); return; }

    const currentTitle = generatedPages[selectedPage]?.title ?? selectedPage;
    const normalizedTitle = currentTitle.toLowerCase().replace(/[-_]/g, ' ');

    const load = async () => {
      try {
        const catRes = await fetch('/api/catalog');
        if (!catRes.ok) { setDiagramEdgeData(null); return; }
        const { flows } = await catRes.json() as { flows: { id: string; name: string; diagramDataFile?: string }[] };

        // Match page title against flow name (simple word overlap)
        const matched = flows.find(fl => {
          if (!fl.diagramDataFile) return false;
          const flowName = fl.name.toLowerCase();
          const pageWords = normalizedTitle.split(' ').filter(w => w.length > 3);
          return pageWords.some(w => flowName.includes(w)) || normalizedTitle.includes(flowName);
        });

        if (!matched) { setDiagramEdgeData(null); return; }

        // Check cache
        const cache = edgeDataCacheRef.current;
        if (cache.has(matched.id)) { setDiagramEdgeData(cache.get(matched.id)!); return; }

        const detailRes = await fetch(`/api/catalog/detail?flowId=${matched.id}`);
        const data: DiagramEdgeData | null = detailRes.ok ? await detailRes.json() : null;
        cache.set(matched.id, data);
        setDiagramEdgeData(data);
      } catch {
        setDiagramEdgeData(null);
      }
    };

    load();
  }, [selectedPage, generatedPages]);

  // Scroll to top when selected page changes
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0 });
      setShowScrollTop(false);
    }
  }, [selectedPage]);

  // After page content renders, scroll to hash-targeted heading if present.
  // Polls every 50ms (up to 500ms) because AnimatePresence mode="wait" delays
  // new content mounting until the 200ms exit animation completes.
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash || !selectedPage) return;
    const headingId = hash.slice(1);
    if (!headingId) return;

    let cancelled = false;
    let attempts = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const container = contentRef.current;
      const el = container?.querySelector(`#${CSS.escape(headingId)}`);
      if (el) {
        const offset =
          el.getBoundingClientRect().top -
          (container?.getBoundingClientRect().top ?? 0) +
          (container?.scrollTop ?? 0) - 80;
        container?.scrollTo({ top: offset, behavior: 'smooth' });
        return;
      }
      attempts++;
      if (attempts < 10) setTimeout(tryScroll, 50);
    };

    setTimeout(tryScroll, 50);
    return () => { cancelled = true; };
  }, [selectedPage]);

  // Restore sidebar scroll after page transition (prevents LNB jumping to top)
  useLayoutEffect(() => {
    if (sidebarRef.current) {
      sidebarRef.current.scrollTop = savedSidebarScrollRef.current;
    }
  }, [selectedPage]);

  // Scan every mermaid block across all pages and return the ones that fail to
  // parse. Parses the SAME sanitized input the <Mermaid> renderer uses, so a
  // diagram that renders fine is not reported as broken. Reused on load and
  // re-run after any fix so the "다이어그램 전체 수정 (N)" count stays accurate.
  const detectBrokenDiagrams = async (
    pages: Record<string, WikiPage>
  ): Promise<{ pageId: string; chartCode: string }[]> => {
    const broken: { pageId: string; chartCode: string }[] = [];
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true });
      let idCounter = 0;
      for (const [pageId, pageData] of Object.entries(pages)) {
        const content = pageData?.content || "";
        for (const match of content.matchAll(/```(?:mermaid)\n([\s\S]*?)\n```/gi)) {
          const chartCode = match[1];
          const sanitized = sanitizeMermaidChart(chartCode);
          try {
            await mermaid.parse(sanitized);
          } catch {
            // parse() can be stricter than render() in mermaid v11 — fall back to render()
            // to avoid false positives on valid diagrams (e.g. architecture-beta, unicode IDs).
            try {
              await mermaid.render(`detect-broken-${idCounter++}`, sanitized);
            } catch {
              broken.push({ pageId, chartCode });
            }
          }
        }
      }
    } catch (e) {
      console.error("Failed to check diagrams:", e);
    }
    return broken;
  };

  // Export state
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportTarget, setExportTarget] = useState<"notion" | "obsidian" | "markdown">("notion");
  // markdown layout: single concatenated file vs directory-tree zip
  const [exportStructure, setExportStructure] = useState<"single" | "tree">("single");
  const [exportKey, setExportKey] = useState("");
  const [exportParentId, setExportParentId] = useState("");
  const [exportVault, setExportVault] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // Scroll to top on page change
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [selectedPage]);

  const handleScroll = () => {
    if (contentRef.current) {
      setShowScrollTop(contentRef.current.scrollTop > 300);
    }
  };

  useEffect(() => {
    async function loadWiki() {
      if (!projectData) return;
      try {
        setIsLoading(true);
        const params = new URLSearchParams({
          owner: projectData.owner,
          repo: projectData.repo,
          repo_type: projectData.repo_type,
          language: currentLang,
          comprehensive: "true",
        });
        if (projectData.model) {
          params.append("model", projectData.model);
        }
        let fetchUrl = `/api/wiki_cache?${params.toString()}`;
        if (isShowcase && projectData.id) {
          fetchUrl = `/showcase-data/wiki_${projectData.id}.json`;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error("위키 데이터를 불러오는데 실패했습니다.");
        }

        const cachedData = await response.json();
        if (cachedData && cachedData.wiki_structure && cachedData.generated_pages) {
          const structure: WikiStructure = {
            ...cachedData.wiki_structure,
            sections: cachedData.wiki_structure.sections || [],
            rootSections: cachedData.wiki_structure.rootSections || [],
            pages: cachedData.wiki_structure.pages || []
          };

          setWikiStructure(structure);
          setGeneratedPages(cachedData.generated_pages);
          if (cachedData.model) setWikiModel(cachedData.model);
          // 소스 기반 질의(P4)에 쓰일 원본 레포 경로 (생성 시 캐시에 저장됨)
          setRepoPath(cachedData.source_path || cachedData.repo?.localPath || cachedData.repo?.repoUrl || "");
          setArtifactRoot(cachedData.artifact_root || "");

          // Resolve per-subproject git roots so GitHub links point at each
          // individual repository (.git root) rather than the bundling parent.
          // Priority: user custom override > API git_roots > cached githubRepoUrl in JSON.
          // In showcase mode the file system is unavailable — use cached URL directly.
          const cachedRepoUrl = cachedData.repo?.githubRepoUrl
            ? cachedData.repo.githubRepoUrl.replace(/\.git$/, '').replace(/\/$/, '')
            : null;
          if (cachedRepoUrl) setAutoDetectedGithubUrl(cachedRepoUrl);

          const applyGitRoots = (roots: GitRoot[]) => {
            if (roots.length > 0) {
              // Save the auto-detected primary URL
              const primary = roots.find(r => r.prefix === '' && r.webUrl) || roots.find(r => r.webUrl);
              if (primary?.webUrl) setAutoDetectedGithubUrl(primary.webUrl.replace(/\.git$/, '').replace(/\/$/, ''));
              if (customGithubUrl) {
                // Override only the primary remote while preserving .git-derived
                // localPath/files/branch metadata used for exact path validation.
                const primaryIndex = Math.max(0, roots.findIndex(r => r === primary));
                setGitRoots(roots.map((root, index) => index === primaryIndex
                  ? { ...root, webUrl: customGithubUrl.replace(/\.git$/, '').replace(/\/$/, '') }
                  : root));
              } else {
                setGitRoots(roots);
              }
            } else if (customGithubUrl) {
              setGitRoots([{ prefix: '', name: projectData.repo, webUrl: customGithubUrl, branch: 'main' }]);
            } else if (cachedRepoUrl) {
              setGitRoots([{ prefix: '', name: cachedData.repo?.repo || projectData.repo, webUrl: cachedRepoUrl, branch: cachedData.repo?.githubBranch || 'main' }]);
            } else {
              setGitRoots([]);
            }
          };

          if (isShowcase) {
            const effectiveUrl = customGithubUrl || cachedRepoUrl;
            if (effectiveUrl) {
              setGitRoots([{
                prefix: '',
                name: cachedData.repo?.repo || projectData.repo,
                webUrl: effectiveUrl.replace(/\.git$/, '').replace(/\/$/, ''),
                branch: cachedData.repo?.githubBranch || 'main',
              }]);
            } else {
              setGitRoots([]);
            }
          } else {
            const gitParams = new URLSearchParams({
              owner: projectData.owner,
              repo: projectData.repo,
              repo_type: projectData.repo_type,
              language: currentLang,
            });
            if (projectData.model) gitParams.append("model", projectData.model);
            fetch(`/api/git_roots?${gitParams.toString()}`)
              .then(r => r.ok ? r.json() : null)
              .then(data => { applyGitRoots(data?.roots ?? []); })
              .catch(() => { applyGitRoots([]); });
          }

          setTimeout(() => {
            void detectBrokenDiagrams(cachedData.generated_pages).then(setBrokenDiagrams);
          }, 1000);

          // Build tree
          const newTree: TreeItem[] = [];
          const newExpanded = new Set<string>();
          const newAllPages: TreeItem[] = [];

          function buildSection(sectionId: string): TreeItem | null {
            const section = structure.sections.find(s => s.id === sectionId);
            if (!section) return null;
            newExpanded.add(section.id);

            const children: TreeItem[] = [];

            if (section.subsections) {
              for (const subId of section.subsections) {
                const subNode = buildSection(subId);
                if (subNode) children.push(subNode);
              }
            }

            if (section.pages) {
              for (const pageId of section.pages) {
                const page = structure.pages.find(p => p.id === pageId);
                if (page) {
                  const item: TreeItem = { id: page.id, title: formatDisplayTitle(page.title || page.id), icon: "file" };
                  children.push(item);
                  newAllPages.push(item);
                }
              }
            }

            return {
              id: section.id,
              title: formatDisplayTitle(section.title || section.id),
              icon: "folder",
              children
            };
          }

          for (const rootId of structure.rootSections) {
            const node = buildSection(rootId);
            if (node) newTree.push(node);
          }

          // Select the page from URL ?page= if valid, otherwise the first page
          const pageToSelect =
            (intentionalPageRef.current && cachedData.generated_pages[intentionalPageRef.current])
              ? intentionalPageRef.current
              : newAllPages[0]?.id ?? "";
          if (pageToSelect) {
            selectedPageRef.current = pageToSelect;
            setSelectedPage(pageToSelect);
          }
          setIsLoading(false);

          // Build tree in a non-blocking transition — LNB renders after first page is visible
          startTransition(() => {
            setTree(newTree);
            setExpanded(newExpanded);
            setAllPages(newAllPages);
          });
        } else {
          console.error("No valid wiki structure or pages found in the cached response.");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    }
    loadWiki();
  }, [projectData, currentLang, refreshKey]);

  const handleResyncLinks = async () => {
    if (!projectData || isResyncingLinks) return;
    setIsResyncingLinks(true);
    setResyncResult(null);
    try {
      const res = await fetch('/api/wiki/resync_links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: projectData.owner,
          repo: projectData.repo,
          repo_type: projectData.repo_type,
          language: currentLang,
          model: projectData.model || null,
        }),
      });
      const data = await res.json();
      setResyncResult({ links_fixed: data.links_fixed || 0 });
      if (data.links_fixed > 0) {
        // Reload cache to pick up the fixed content
        setRefreshKey(k => k + 1);
      }
    } catch {
      setResyncResult({ links_fixed: -1 });
    } finally {
      setIsResyncingLinks(false);
    }
  };

  const handleRegenerate = async (targetPageId?: string) => {
    if (!selectedPage || !projectData || !wikiStructure) return;
    const pageIdToFix = targetPageId || selectedPage;
    const currentPageData = generatedPages[pageIdToFix];
    if (!currentPageData) return;

    setLocalLoadingPages(prev => ({ ...prev, [pageIdToFix]: true }));
    setShowRegenModal(false);

    try {
      let apiKey = "";
      let mode = "api";
      let provider = "google";
      let model = "gemini-2.5-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            mode = (settings.useCli ?? true) ? "cli" : "api";
            provider = settings.provider || "google";
            model = settings.model || "gemini-2.5-flash";
          } catch (e) {}
        }
      }

      const newContent = await regenerateWikiPage({
        streamId: crypto.randomUUID(),
        projectPath: `${projectData.owner}/${projectData.repo}`,
        repo_type: projectData.repo_type,
        model,
        provider,
        mode,
        apiKey,
        language: currentLang,
        page: currentPageData,
        customPrompt: regenPromptRef.current?.value || ""
      });

      if (!newContent || newContent.trim() === '') {
        throw new Error("LLM이 빈 내용을 반환했습니다. 원본 텍스트를 유지합니다.");
      }

      const updatedPage = { ...currentPageData, content: newContent };
        const newGeneratedPages = { ...generatedPages, [pageIdToFix]: updatedPage };
      setGeneratedPages(newGeneratedPages);

      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: newGeneratedPages,
          provider: (() => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}').provider || 'google'; } catch { return 'google'; } })(),
          model: projectData.model
        })
      });

    } catch (err) {
      alert(`재생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLocalLoadingPages(prev => ({ ...prev, [pageIdToFix]: false }));
      if (regenPromptRef.current) regenPromptRef.current.value = "";
    }
  };

  // Read generation settings from localStorage (shared by page/section regen).
  const readGenSettings = () => {
    let s: Record<string, any> = {};
    if (typeof window !== "undefined") {
      try { s = JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || "{}"); } catch {}
    }
    return {
      apiKey:          s.apiKey          || "",
      mode:            (s.useCli ?? true) ? "cli" : "api",
      provider:        s.provider        || "",
      model:           s.model           || "",
      cliTool:         s.cliTool         || (s.provider === "openai" ? "codex" : s.provider === "anthropic" ? "claude" : "gemini"),
      pageConcurrency: s.pageConcurrency ?? 3,
    };
  };

  // Collect all page ids belonging to a section, recursing into subsections.
  const collectSectionPageIds = (sectionId: string): string[] => {
    const sec = (wikiStructure?.sections || []).find((s: WikiSection) => s.id === sectionId);
    if (!sec) return [];
    let ids: string[] = [...(sec.pages || [])];
    for (const subId of (sec.subsections || [])) {
      ids = ids.concat(collectSectionPageIds(subId));
    }
    return ids;
  };

  // Directory(section)-level regeneration: regenerate every page in the section
  // sequentially using the same per-page path, then save the cache once.
  const handleRegenerateSection = async (sectionId: string, sectionTitle: string) => {
    if (!projectData || !wikiStructure || regeneratingSectionId) return;
    // The business section is produced by analyze_business, not page regen.
    if (sectionId === "__section_business__") {
      await handleGenerateBusiness();
      return;
    }
    const pageIds = collectSectionPageIds(sectionId).filter((id) => !id.startsWith("__business"));
    if (pageIds.length === 0) return;
    if (!window.confirm(`"${sectionTitle}" 섹션의 ${pageIds.length}개 페이지를 재생성합니다.\nLLM이 ${pageIds.length}회 호출됩니다 (시간·비용 소모). 계속할까요?`)) return;

    setRegeneratingSectionId(sectionId);
    setSectionRegenProgress({ current: 0, total: pageIds.length });
    const { apiKey, mode, provider, model } = readGenSettings();

    try {
      let working = { ...generatedPages };
      for (let i = 0; i < pageIds.length; i++) {
        const pid = pageIds[i];
        const pageData = working[pid];
        setSectionRegenProgress({ current: i + 1, total: pageIds.length });
        if (!pageData) continue;
        try {
          const newContent = await regenerateWikiPage({
            streamId: crypto.randomUUID(),
            projectPath: `${projectData.owner}/${projectData.repo}`,
            repo_type: projectData.repo_type,
            model, provider, mode, apiKey,
            language: currentLang,
            page: pageData,
            customPrompt: "",
          });
          if (newContent && newContent.trim() !== "") {
            working = { ...working, [pid]: { ...pageData, content: newContent } };
            setGeneratedPages(working);
          }
        } catch (e) {
          console.error(`섹션 재생성: '${pid}' 실패`, e);
        }
      }

      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: working,
          provider, model: projectData.model,
        })
      });
      alert(`"${sectionTitle}" 섹션 ${pageIds.length}개 페이지 재생성을 완료했습니다.`);
    } catch (err) {
      alert(`섹션 재생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegeneratingSectionId(null);
      setSectionRegenProgress({ current: 0, total: 0 });
    }
  };

  // Find all pages whose content is empty or contains a generation error.
  const getFailedPageIds = (): string[] => {
    if (!wikiStructure) return [];
    return (wikiStructure.pages || [])
      .map((p: WikiPage) => p.id)
      .filter((id: string) => {
        if (id.startsWith("__business")) return false;
        const page = generatedPages[id];
        if (!page) return true;
        const c = (page.content || "").trim();
        // Match the exact stub format written by wiki-generator on failure: "> ⚠️ 생성 실패: ..."
        // Don't match bare "CLI Error" / "생성 실패" — those strings legitimately appear in docs.
        if (!c) return true;
        if (c.includes("> ⚠️ 생성 실패")) return true;
        // Edge-case: raw error text stored without the stub wrapper (very short content only)
        if (c.length < 400 && (c.includes("CLI Error:") || c.includes("SSE connection error"))) return true;
        return false;
      });
  };

  // Bulk-regenerate all failed/empty pages in parallel (respects pageConcurrency setting).
  const handleBulkRegenFailed = async () => {
    if (!projectData || !wikiStructure || isBulkRegening) return;
    const failedIds = getFailedPageIds();
    if (failedIds.length === 0) return;
    const { apiKey, mode, provider, model, pageConcurrency } = readGenSettings();
    if (!window.confirm(`실패한 ${failedIds.length}개 페이지를 재생성합니다.\n동시 ${pageConcurrency}개 병렬 처리됩니다. 계속할까요?`)) return;

    setIsBulkRegening(true);
    setBulkRegenProgress({ current: 0, total: failedIds.length });

    try {
      const queue = [...failedIds];
      let completed = 0;
      let working = { ...generatedPages };

      const worker = async () => {
        while (true) {
          const pid = queue.shift();
          if (!pid) break;
          const pageData = working[pid] ?? (wikiStructure.pages || []).find((p: WikiPage) => p.id === pid);
          if (!pageData) { completed++; setBulkRegenProgress({ current: completed, total: failedIds.length }); continue; }
          try {
            const newContent = await regenerateWikiPage({
              streamId: crypto.randomUUID(),
              projectPath: `${projectData.owner}/${projectData.repo}`,
              repo_type: projectData.repo_type,
              model, provider, mode, apiKey,
              language: currentLang,
              page: pageData,
              customPrompt: "",
            });
            if (newContent && newContent.trim() !== "") {
              working = { ...working, [pid]: { ...pageData, content: newContent } };
              setGeneratedPages({ ...working });
            }
          } catch (e) {
            console.error(`bulk regen: '${pid}' 실패`, e);
          }
          completed++;
          setBulkRegenProgress({ current: completed, total: failedIds.length });
        }
      };

      await Promise.all(Array.from({ length: Math.min(pageConcurrency, failedIds.length) }, () => worker()));

      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: working,
          provider, model: projectData.model,
        })
      });
    } catch (err) {
      console.error("bulk regen 실패:", err);
    } finally {
      setIsBulkRegening(false);
      setBulkRegenProgress({ current: 0, total: 0 });
    }
  };

  // Run business analysis on the current repo and merge the business section
  // into the wiki + cache (for wikis originally generated without business).
  const handleGenerateBusiness = async () => {
    if (!projectData || isGeneratingBusiness) return;
    const repoUrl = repoPath || `${projectData.owner}/${projectData.repo}`;
    setIsGeneratingBusiness(true);
    const { apiKey, mode, provider, model } = readGenSettings();
    const cliTool = provider === "google" ? "gemini" : provider === "anthropic" ? "claude" : provider === "antigravity" ? "antigravity" : "codex";

    try {
      const bizRes = await fetch('/api/analyze_business', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo_url: repoUrl, repo_urls: [repoUrl],
          language: currentLang, provider, model, mode, cli_tool: cliTool,
          ...(apiKey ? { api_key: apiKey } : {}),
        })
      });
      if (!bizRes.ok) throw new Error(`분석 요청 실패 (${bizRes.status})`);
      const bizData = await bizRes.json();

      const businessPageIds = ["__business_overview__", "__business_dataflow__", "__business_workflow__", "__business_impact__"];
      const isMultiRepo = Boolean(bizData.is_multi_repo);
      const bizPages = [
        { id: "__business_overview__", title: isMultiRepo ? "Cross-Repository Business Overview" : "Business Overview", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages?.__business_overview__ || "" },
        { id: "__business_dataflow__", title: isMultiRepo ? "Cross-Repository Data Flow" : "Data Flow", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages?.__business_dataflow__ || "" },
        { id: "__business_workflow__", title: isMultiRepo ? "Cross-Repository Workflows" : "Workflows", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages?.__business_workflow__ || "" },
        { id: "__business_impact__", title: isMultiRepo ? "Cross-Repository Impact Analysis" : "Impact Analysis", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages?.__business_impact__ || "" },
      ];

      // Merge the business section into a fresh copy of the structure + pages.
      const structure: WikiStructure = JSON.parse(JSON.stringify(wikiStructure));
      structure.sections = (structure.sections || []).filter((s: WikiSection) => s.id !== "__section_business__");
      structure.sections.push({
        id: "__section_business__",
        title: isMultiRepo ? "Cross-Repository Business Analysis" : (currentLang !== "ko" ? "Business Analysis" : "비즈니스 분석"),
        pages: businessPageIds,
      });
      structure.rootSections = [
        ...(structure.rootSections || []).filter((id: string) => id !== "__section_business__"),
        "__section_business__",
      ];
      structure.pages = (structure.pages || []).filter((p: WikiPage) => !businessPageIds.includes(p.id)).concat(bizPages);

      const newGeneratedPages = { ...generatedPages };
      for (const p of bizPages) newGeneratedPages[p.id] = p;

      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: structure,
          generated_pages: newGeneratedPages,
          provider, model: projectData.model,
        })
      });
      // Reload so the sidebar tree rebuilds with the new business section.
      setRefreshKey((k) => k + 1);
      alert("비즈니스 분석을 생성하여 위키에 추가했습니다.");
    } catch (err) {
      alert(`비즈니스 분석 생성 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsGeneratingBusiness(false);
    }
  };

  const handleGenerateTestScenarios = async (flowId?: string) => {
    if (!projectData || isGeneratingTests) return;
    if (!repoPath || !artifactRoot) { alert('소스 또는 위키 산출물 경로를 찾을 수 없습니다. 위키를 다시 열어 주세요.'); return; }

    setIsGeneratingTests(true);
    setShowTestScenarios(true);
    setTestScenarioResults([]);
    const ts0 = new Date().toISOString();
    setTestGenProgress({ flowId: flowId ?? 'all', phase: 'parsing', phaseLabel: '파싱', progress: 0, message: '시나리오 생성 시작...', timestamp: ts0 });

    const streamId = `test-${Date.now()}`;
    const { provider, model, apiKey, mode, cliTool } = readGenSettings();

    const loadGeneratedScenarios = async () => {
      const response = await fetch(`/api/wiki/test-scenarios?artifactRoot=${encodeURIComponent(artifactRoot)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      setTestScenarioResults(manifestToViewerScenarios(payload.manifest, payload.documents));
    };

    try {
      const catRes = await fetch('/api/catalog');
      const catalogFlows = catRes.ok ? (await catRes.json()).flows ?? [] : [];

      const { createTaskStream } = await import('@/lib/taskStreamClient');
      const es = createTaskStream(streamId, {
        onEvent: (ev: PipelineEvent) => {
          const PHASE_MAP: Record<string, import('@/lib/test-scenario-types').TestGenPhase> = {
            parsing: 'parsing', 'analyzing-cross-flow': 'analyzing-cross-flow',
            'building-prompt': 'building-prompt', generating: 'generating', 'writing-output': 'writing-output',
          };
          if (ev.type === 'agent_log' || ev.type === 'phase_start') {
            setTestGenProgress((prev) => {
              const entry: import('@/lib/test-scenario-types').LogEntry = { level: 'info', message: ev.message, timestamp: ev.ts ?? new Date().toISOString() };
              const phaseKey = ev.phase ?? '';
              const phase = PHASE_MAP[phaseKey] ?? prev?.phase ?? 'parsing';
              const progressVal = typeof ev.data?.percent === 'number' ? ev.data.percent : (prev?.progress ?? 0);
              return { flowId: flowId ?? 'all', phase, phaseLabel: ev.phase ?? phase, progress: progressVal, message: ev.message, timestamp: ev.ts ?? new Date().toISOString(), logEntries: [...(prev?.logEntries ?? []), entry] };
            });
          }
          if (ev.type === 'complete') {
            setTestGenProgress((prev) => prev ? { ...prev, phase: 'writing-output', progress: 100, message: '생성 완료', timestamp: new Date().toISOString() } : null);
            es.close();
            void loadGeneratedScenarios().finally(() => {
              setIsGeneratingTests(false);
              setTestGenProgress(null);
            });
          }
          if (ev.type === 'error') {
            setTestGenProgress((prev) => prev ? { ...prev, message: `오류: ${ev.message}`, timestamp: new Date().toISOString() } : null);
            es.close();
            void loadGeneratedScenarios().finally(() => setIsGeneratingTests(false));
          }
        },
      });

      const startResponse = await fetch('/api/wiki/test-scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath: repoPath,
          artifactRoot,
          flowIds: flowId && flowId !== 'all' ? [flowId] : [],
          streamId,
          provider,
          model,
          mode,
          cliTool,
          language: currentLang,
          ...(apiKey ? { apiKey } : {}),
          catalogFlows,
        }),
      });
      if (!startResponse.ok) {
        es.close();
        const failure = await startResponse.json().catch(() => ({ error: startResponse.statusText }));
        throw new Error(failure.error ?? `HTTP ${startResponse.status}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setTestGenProgress((prev) => prev ? { ...prev, message: `오류: ${errorMsg}`, timestamp: new Date().toISOString() } : null);
      setIsGeneratingTests(false);
    }
  };

  const handleFixDiagram = async (chartCode: string, customInstruction?: string, targetPageId?: string) => {
    if (!selectedPage || !projectData || !wikiStructure) return;
    const currentPageData = generatedPages[selectedPage];
    if (!currentPageData) return;

    let model = "gemini-2.5-flash";
    let provider = "google";
    let useCli = true;
    let cliTool = "gemini";
    let apiKey = "";
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem(APP_SETTINGS_KEY);
      if (raw) {
        try {
          const settings = JSON.parse(raw);
          model = settings.model || model;
          provider = settings.provider || provider;
          useCli = settings.useCli ?? true;
          cliTool = provider === "google" ? "gemini"
            : provider === "anthropic" ? "claude"
            : provider === "antigravity" ? "antigravity"
            : "codex";
          apiKey = settings.apiKey || "";
        } catch (e) {}
      }
    }

    try {
      // Fire-and-forget: backend handles LLM call + cache save autonomously.
      // The frontend does NOT need to stay on the page for the fix to complete.
      const resp = await fetch('/api/fix_diagram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: projectData.owner,
          repo: projectData.repo,
          repo_type: projectData.repo_type,
          language: currentLang,
          model: projectData.model ?? model,
          provider,
          use_cli: useCli,
          cli_tool: cliTool,
          page_id: targetPageId || selectedPage,
          chart_code: chartCode,
          custom_instruction: customInstruction || null,
        }),
      });

      if (!resp.ok) throw new Error(`API 요청 실패 (${resp.status})`);
      const { job_id } = await resp.json();

      // Wait for the background task to complete so the UI loading spinner stays active
      await new Promise<void>((resolve, reject) => {
        const evtSource = new EventSource(`/api/task-streams/${job_id}/stream`);

        const cleanup = () => {
          evtSource.close();
          resolve(); // Resolve the promise when cleaning up to stop the spinner
        };

        evtSource.addEventListener('complete', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            if (data.data?.page_id) {
              // Reload the cache from server so the diagram shows the fixed version.
              fetch(`/api/wiki_cache?owner=${projectData.owner}&repo=${projectData.repo}&repo_type=${projectData.repo_type}&language=${currentLang}&model=${model}`)
                .then(r => r.ok ? r.json() : null)
                .then(cacheData => {
                  if (cacheData?.generated_pages) {
                    setGeneratedPages(cacheData.generated_pages);
                    // Recompute so the broken-diagram count reflects the fix.
                    void detectBrokenDiagrams(cacheData.generated_pages).then(setBrokenDiagrams);
                  }
                })
                .catch(() => {});
            }
          } catch (_) {}
          cleanup();
        });

        evtSource.addEventListener('error', (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            console.warn('fix_diagram error:', data.message);
            alert(`다이어그램 수정 중 오류 발생: ${data.message}`);
          } catch (_) {}
          cleanup();
        });

        evtSource.onerror = () => {
          cleanup();
        };
      });

    } catch (e) {
      alert(`다이어그램 수정 요청 실패: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  };

  const handleBlockAction = useCallback(async (type: "fix" | "delete", blockContent: string, startLine?: number, endLine?: number, prompt?: string) => {
    if (!selectedPage || !projectData || !wikiStructure) return;
    const currentPageData = generatedPages[selectedPage];
    if (!currentPageData) return;

    if (type === "delete") {
      // The startLine and endLine correspond to normalizedContent, NOT currentPageData.content.
      // Therefore, string replacement is safer than line number slicing.
      // We also replace it in the un-normalized content as best effort.
      const blockContentNormalized = blockContent.trim();
      let finalContent = currentPageData.content;
      
      if (finalContent.includes(blockContentNormalized)) {
        finalContent = finalContent.replace(blockContentNormalized, '');
      } else if (finalContent.includes(blockContent)) {
        finalContent = finalContent.replace(blockContent, '');
      } else {
         // Fallback to line splicing if string matching fails
         if (startLine !== undefined && endLine !== undefined) {
          const lines = currentPageData.content.split('\n');
          lines.splice(startLine, endLine - startLine + 1);
          finalContent = lines.join('\n');
        }
      }

      const updatedPage = { ...currentPageData, content: finalContent };
      const newGeneratedPages = { ...generatedPages, [selectedPage]: updatedPage };
      setGeneratedPages(newGeneratedPages);

      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: newGeneratedPages,
          provider: (() => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}').provider || 'google'; } catch { return 'google'; } })(),
          model: projectData.model
        })
      });
      return;
    }

    // type === "fix"
    if (!prompt) return;
    try {
      const fixPrompt = `You are editing a section of a technical wiki page written in Markdown.
Modify the following markdown block according to the user's instruction.

User Instruction: ${prompt}

${wikiLanguageInstruction(currentLang)}

Output ONLY the modified markdown block. Do not include any explanation or conversational text. Preserve markdown formatting.

Original Block:
${blockContent}`;

      let apiKey = "";
      let useCli = true;
      let cliTool = "gemini";
      let provider = "google";
      let model = "gemini-2.5-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const s = JSON.parse(raw);
            apiKey = s.apiKey || "";
            useCli = s.useCli ?? true;
            cliTool = s.provider === "google" ? "gemini" : s.provider === "anthropic" ? "claude" : s.provider === "antigravity" ? "antigravity" : "codex";
            provider = s.provider || "google";
            model = s.model || "gemini-2.5-flash";
          } catch (e) {}
        }
      }

      const reqBody = {
        repo_url: `${projectData.owner}/${projectData.repo}`,
        type: projectData.repo_type,
        stream_id: crypto.randomUUID(),
        messages: [{ role: 'user', content: fixPrompt }],
        model,
        provider,
        language: currentLang,
        skip_rag: true,
        is_wiki_generation: true,
        use_cli: useCli,
        cli_tool: cliTool,
        ...(apiKey ? { api_key: apiKey } : {})
      };

      const resp = await fetch(`/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });

      if (!resp.ok) throw new Error("API 요청 실패");

      let newBlockContent = '';
      const decoder = new TextDecoder();
      if (resp.body) {
        const reader = resp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          newBlockContent += decoder.decode(value, { stream: true });
        }
        newBlockContent += decoder.decode();
      }

      newBlockContent = newBlockContent.trim();
      // Strip wrapping code fence if the LLM accidentally added one
      newBlockContent = newBlockContent.replace(/^```(?:markdown)?\n/i, '').replace(/\n```$/, '').trim();

      if (newBlockContent && newBlockContent !== blockContent) {
        let newPageContent = currentPageData.content;
        if (startLine !== undefined && endLine !== undefined) {
          const lines = currentPageData.content.split('\n');
          lines.splice(startLine, endLine - startLine + 1, newBlockContent);
          newPageContent = lines.join('\n');
        } else {
          newPageContent = currentPageData.content.replace(blockContent, newBlockContent);
        }

        const updatedPage = { ...currentPageData, content: newPageContent };
        const newGeneratedPages = { ...generatedPages, [selectedPage]: updatedPage };
        setGeneratedPages(newGeneratedPages);

        await fetch('/api/wiki_cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
            language: currentLang,
            wiki_structure: wikiStructure,
            generated_pages: newGeneratedPages,
            provider: (() => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}').provider || 'google'; } catch { return 'google'; } })(),
            model: projectData.model
          })
        });
      }
    } catch (e) {
      alert(`블록 수정 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [selectedPage, projectData, wikiStructure, generatedPages, currentLang]);

  const handleManualCodeChange = async (oldCode: string, newCode: string, targetPageId: string) => {
    if (!projectData || !wikiStructure || !generatedPages[targetPageId]) return;

    try {
      const currentPageData = generatedPages[targetPageId];
      const newPageContent = currentPageData.content.replaceAll(oldCode, newCode);

      const newGeneratedPages = {
        ...generatedPages,
        [targetPageId]: {
          ...currentPageData,
          content: newPageContent
        }
      };

      setGeneratedPages(newGeneratedPages);

      // Save cache
      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: newGeneratedPages,
          provider: (() => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}').provider || 'google'; } catch { return 'google'; } })(),
          model: projectData.model
        })
      });
    } catch (e) {
      console.error("Failed to save manual edit", e);
    }
  };

  const handleFixAllDiagrams = async () => {
    if (brokenDiagrams.length === 0 || !projectData || !wikiStructure) return;
    setIsBatchFixing(true);
    setBatchFixProgress({ current: 0, total: brokenDiagrams.length });

    try {
      let currentGeneratedPages = { ...generatedPages };

      let apiKey = ""; let useCli = true; let cliTool = "gemini"; let provider = "google"; let model = "gemini-2.5-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            useCli = settings.useCli ?? true;
            cliTool = settings.provider === "google" ? "gemini" : settings.provider === "anthropic" ? "claude" : settings.provider === "antigravity" ? "antigravity" : "codex";
            provider = settings.provider || "google";
            model = settings.model || "gemini-2.5-flash";
          } catch (e) {}
        }
      }

      for (let i = 0; i < brokenDiagrams.length; i++) {
        const { pageId, chartCode } = brokenDiagrams[i];
        setBatchFixProgress({ current: i + 1, total: brokenDiagrams.length });

        const fixPrompt = `The following Mermaid diagram has a syntax error.
Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Keep all node/edge label text in its ORIGINAL language — do NOT translate labels. Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.

Original Diagram:
\`\`\`mermaid
${chartCode}
\`\`\``;

        const pageReqBody = {
          repo_url: `${projectData.owner}/${projectData.repo}`,
          type: projectData.repo_type,
          stream_id: crypto.randomUUID(),
          messages: [{ role: 'user', content: fixPrompt }],
          model, provider, language: currentLang, skip_rag: true, is_wiki_generation: true, use_cli: useCli, cli_tool: cliTool, ...(apiKey ? { api_key: apiKey } : {})
        };

        const fixResp = await fetch(`/api/chat/stream`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pageReqBody)
        });

        if (fixResp.ok && fixResp.body) {
          let fixedContent = '';
          const decoder = new TextDecoder();
          const reader = fixResp.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fixedContent += decoder.decode(value, { stream: true });
          }
          fixedContent += decoder.decode();

          const match = fixedContent.match(/```mermaid\n([\s\S]*?)\n```/i) || fixedContent.match(/```\n([\s\S]*?)\n```/i);
          let newDiagramCode = match ? match[1] : fixedContent.trim();
          newDiagramCode = newDiagramCode.replace(/^```(mermaid)?\n/i, '').replace(/\n```$/, '').trim();

          if (newDiagramCode) {
            const oldContent = currentGeneratedPages[pageId].content;
            const newPageContent = oldContent.replaceAll(chartCode, newDiagramCode);
            if (newPageContent !== oldContent) {
              currentGeneratedPages[pageId] = { ...currentGeneratedPages[pageId], content: newPageContent };
            }
          }
        }
      }

      setGeneratedPages(currentGeneratedPages);
      await fetch('/api/wiki_cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: { owner: projectData.owner, repo: projectData.repo, type: projectData.repo_type },
          language: currentLang,
          wiki_structure: wikiStructure,
          generated_pages: currentGeneratedPages,
          provider: (() => { try { return JSON.parse(localStorage.getItem(APP_SETTINGS_KEY) || '{}').provider || 'google'; } catch { return 'google'; } })(),
          model: projectData.model
        })
      });
      // Recompute against the patched content rather than assuming all fixed —
      // some diagrams may still fail to parse after the LLM's attempt.
      const remaining = await detectBrokenDiagrams(currentGeneratedPages);
      setBrokenDiagrams(remaining);
      const fixedCount = brokenDiagrams.length - remaining.length;
      alert(
        remaining.length === 0
          ? `성공적으로 ${fixedCount}개의 다이어그램 오류를 복구했습니다.`
          : `${fixedCount}개를 복구했습니다. ${remaining.length}개는 자동 복구에 실패하여 수동 수정이 필요합니다.`
      );
    } catch (e) {
      alert(`다이어그램 일괄 복구 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsBatchFixing(false);
    }
  };
  const handleExport = async () => {
    if (!projectData || !wikiStructure) return;
    setIsExporting(true);

    try {
      const exportData = {
        repo_url: `${projectData.owner}/${projectData.repo}`,
        pages: Object.fromEntries(
          Object.entries(generatedPages).map(([k, v]) => [k, (v as WikiPage).content])
        ),
        format: exportTarget
      };

      if (exportTarget === "notion") {
        if (!exportKey || !exportParentId) throw new Error("Notion API Key와 Parent Page ID가 필요합니다.");
        const res = await fetch(`/api/export/notion?api_key=${exportKey}&parent_page_id=${exportParentId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(exportData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Notion 내보내기 실패");
        alert(`✅ 성공적으로 ${data.exported_count}개의 페이지를 Notion으로 내보냈습니다.`);
      }
      else if (exportTarget === "obsidian") {
        if (!exportVault) throw new Error("Obsidian Vault 경로가 필요합니다.");
        const res = await fetch(`/api/export/obsidian?vault_path=${encodeURIComponent(exportVault)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(exportData)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Obsidian 내보내기 실패");
        alert(`✅ 성공적으로 ${data.exported_count}개의 페이지를 Obsidian(${data.output_path})으로 내보냈습니다.`);
      }
      else {
        // Markdown 다운로드 — 단일 파일 또는 디렉토리 구조 zip.
        // tree 모드는 섹션 계층(wiki_structure)으로 폴더를 구성하므로 전체 페이지
        // 객체와 구조를 함께 전송한다.
        const mdRequest = {
          repo_url: `${projectData.owner}/${projectData.repo}`,
          format: "markdown",
          structure: exportStructure,
          wiki_structure: exportStructure === "tree" ? wikiStructure : undefined,
          pages: Object.entries(generatedPages).map(([id, v]) => {
            const p = v as WikiPage;
            return {
              id,
              title: p.title || id,
              content: p.content || "",
              filePaths: p.filePaths || [],
              importance: p.importance || "medium",
              relatedPages: p.relatedPages || [],
            };
          }),
        };
        const res = await fetch('/api/export/wiki', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mdRequest)
        });
        if (!res.ok) throw new Error('Export failed');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const fallbackName = `wiki_export_${Date.now()}.${exportStructure === "tree" ? "zip" : "md"}`;
        const filename = res.headers.get('Content-Disposition')?.split('filename=')[1] || fallbackName;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
      setShowExportModal(false);
    } catch (e) {
      alert(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 40);
      }
      if (e.key === "Escape") {
        setShowSearch(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleFolder = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const navigate = useCallback((id: string) => {
    if (sidebarRef.current) {
      savedSidebarScrollRef.current = sidebarRef.current.scrollTop;
    }
    selectedPageRef.current = id;
    intentionalPageRef.current = id;
    setSelectedPage(id);
    setActiveSection("");
    setShowSearch(false);
    setQuery("");
    // Sync page ID into URL without triggering a Next.js navigation
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('page', id);
      url.hash = '';
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  // Refs that always point to the latest version of each handler,
  // so the stable callbacks below never capture stale closures.
  const handleFixDiagramRef = useRef(handleFixDiagram);
  useEffect(() => { handleFixDiagramRef.current = handleFixDiagram; });
  const handleManualCodeChangeRef = useRef(handleManualCodeChange);
  useEffect(() => { handleManualCodeChangeRef.current = handleManualCodeChange; });

  // Stable callbacks for Markdown props — selectedPageRef avoids recreating on every selectedPage change
  const handleFixDiagramStable = useCallback((chartCode: string, customPrompt?: string) => {
    return handleFixDiagramRef.current(chartCode, customPrompt, selectedPageRef.current);
  }, []);

  const handleCodeChangeStable = useCallback((oldCode: string, newCode: string) => {
    return handleManualCodeChangeRef.current(oldCode, newCode, selectedPageRef.current);
  }, []);

  const navigateToPageByTarget = useCallback((target: string) => {
    // Extract page name from file:///abs/path/PageTitle.md or relative PageTitle.md
    const rawName = target
      .replace(/^file:\/\/\/.*?([^/]+)$/, '$1')  // keep last path segment from file:///
      .replace(/\.md$/i, '')
      .replace(/^_/, '')
      .trim();

    const pages = Object.values(generatedPages);
    let match = pages.find(p => p.title.toLowerCase() === rawName.toLowerCase());
    if (!match) {
      match = pages.find(p =>
        p.title.toLowerCase().includes(rawName.toLowerCase()) ||
        rawName.toLowerCase().includes(p.title.toLowerCase())
      );
    }
    if (match) navigate(match.id);
  }, [generatedPages, navigate]);

  function TreeNode({ item, depth = 0 }: { item: TreeItem; depth?: number }) {
    const isSelected = selectedPage === item.id;
    const isExpanded = expanded.has(item.id);
    const isFolder = item.icon === "folder";

    const isRegenSection = regeneratingSectionId === item.id;

    return (
      <div style={{ position: "relative" }}>
        <button
          onClick={() => (isFolder ? toggleFolder(item.id) : navigate(item.id))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            padding: `7px ${isFolder ? 56 : 10}px 7px ${14 + depth * 14}px`,
            borderRadius: 10,
            background: isSelected ? t.primaryLight : "transparent",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            color: isSelected ? t.primary : t.textSecondary,
            fontWeight: isSelected ? 600 : 400,
            fontSize: 13.5,
            transition: "background 0.15s, color 0.15s",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isSelected) e.currentTarget.style.background = t.surfaceHover; }}
          onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
        >
          {isFolder ? (
            isExpanded ? <FolderOpen size={14} color={isSelected ? t.primary : t.textMuted} /> : <Folder size={14} color={isSelected ? t.primary : t.textMuted} />
          ) : (
            <FileText size={14} color={isSelected ? t.primary : t.textMuted} />
          )}
          <span style={{ flex: 1 }}>{item.title}</span>
          {isFolder && (
            <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.18 }}>
              <ChevronRight size={12} color={t.textMuted} />
            </motion.div>
          )}
        </button>

        {isFolder && !isShowcase && (
          <button
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); handleRegenerateSection(item.id, item.title); }}
            disabled={!!regeneratingSectionId}
            title={`"${item.title}" 섹션(디렉토리) 전체 재생성`}
            style={{
              position: "absolute", top: 6, right: 30,
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 5px", borderRadius: 6, border: "none",
              background: isRegenSection ? t.primaryLight : "transparent",
              color: isRegenSection ? t.primary : t.textMuted,
              cursor: regeneratingSectionId ? "default" : "pointer",
              fontSize: 10,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!regeneratingSectionId) e.currentTarget.style.color = t.primary; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isRegenSection) e.currentTarget.style.color = t.textMuted; }}
          >
            <RefreshCw size={11} className={isRegenSection ? "animate-spin" : ""} />
            {isRegenSection && <span>{sectionRegenProgress.current}/{sectionRegenProgress.total}</span>}
          </button>
        )}

        {isFolder && item.children && (
          <div style={{ overflow: "hidden", maxHeight: isExpanded ? 99999 : 0, opacity: isExpanded ? 1 : 0, transition: "max-height 0.3s ease, opacity 0.18s ease" }}>
            {item.children.map((child) => (
              <TreeNode key={child.id} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const filtered = allPages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  const currentPage = useMemo(() => generatedPages[selectedPage], [generatedPages, selectedPage]);

  const tocHeadings = useMemo(() => {
    const content = currentPage?.content || '';
    const matches = [...content.matchAll(/^(#{1,3})\s+(.+)$/gm)];
    return matches.map((m, i) => ({ level: m[1].length, text: m[2].trim(), domIdx: i, slug: slugifyHeading(m[2].trim()) }));
  }, [currentPage]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        position: "relative",
        width: "100%",
        height: "100vh",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-sans), Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* ── Top header ── */}
      <div className="repolume-window-drag" style={{
        height: 52,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        background: t.bg,
        flexShrink: 0,
        borderBottom: `1px solid ${t.divider}`,
      }}>
        {/* Left */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onGoHome}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: "6px 10px", borderRadius: 10, color: t.text, fontFamily: "inherit", fontSize: 14, fontWeight: 600, transition: "background 0.15s" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "transparent")}
          >
            <RepoLumeMark size={28} />
            RepoLume
          </button>

          <ChevronRight size={13} color={t.textMuted} />
          <span style={{ color: t.textSecondary, fontSize: 13 }}>{projectName}</span>
          {wikiModel && (
            <span style={{ fontSize: 10, fontWeight: 600, color: isDark ? "rgba(160,185,255,0.75)" : "#5271e8", background: isDark ? "rgba(64,150,247,0.12)" : "rgba(64,150,247,0.08)", padding: "2px 7px", borderRadius: 5, letterSpacing: "0.02em", whiteSpace: "nowrap", fontFamily: "inherit" }}>
              {wikiModel}
            </span>
          )}
        </div>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>

          {!isShowcase && (() => {
            const failedCount = getFailedPageIds().length;
            if (failedCount === 0 && !isBulkRegening) return null;
            return (
              <button
                onClick={handleBulkRegenFailed}
                disabled={isBulkRegening}
                title={`실패한 ${failedCount}개 페이지를 한번에 재생성`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: isBulkRegening ? t.surface : "#fef2f2", border: "1px solid #fecaca", cursor: isBulkRegening ? "default" : "pointer", color: "#dc2626", fontSize: 13, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s", whiteSpace: "nowrap" }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isBulkRegening) e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "none"; }}
              >
                <RefreshCw size={14} className={isBulkRegening ? "animate-spin" : ""} />
                <span>{isBulkRegening ? `${bulkRegenProgress.current}/${bulkRegenProgress.total} 재생성 중…` : `실패 ${failedCount}개 재생성`}</span>
              </button>
            );
          })()}

          {!isShowcase && (
            <button
              onClick={() => setShowAsk((v) => !v)}
              title="위키 문서에 질문하기"
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: showAsk ? t.ai : t.aiLight, border: "none", cursor: "pointer", color: showAsk ? "#fff" : t.ai, fontSize: 13, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "none"; }}
            >
              <Sparkles size={14} />
              <span>질문</span>
            </button>
          )}

          {!isShowcase && (
            <button
              onClick={() => setShowExportModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: t.primaryLight, border: "none", cursor: "pointer", color: t.primary, fontSize: 13, fontWeight: 600, fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.transform = "none"; }}
            >
              <Share size={14} />
              <span>내보내기</span>
            </button>
          )}

          <button
            onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 40); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", color: t.textMuted, fontSize: 12, fontFamily: "inherit", transition: "background 0.15s" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surface)}
          >
            <Search size={13} />
            <span>검색</span>
            <kbd style={{ background: isDark ? "#2A2A2A" : "#E4E6EA", color: t.textMuted, fontSize: 10, padding: "2px 5px", borderRadius: 5, fontFamily: "inherit" }}>⌘K</kbd>
          </button>

          {/* 읽기 모드 / 전체 폭 토글 */}
          <button
            onClick={() => setReadingMode((v) => !v)}
            title={readingMode ? "전체 폭으로 보기" : "읽기 모드"}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "6px 10px", borderRadius: 10,
              background: readingMode ? t.primaryLight : t.surface,
              border: "none", cursor: "pointer",
              color: readingMode ? t.primary : t.textSecondary,
              fontSize: 12, fontFamily: "inherit", transition: "all 0.15s",
              fontWeight: readingMode ? 600 : 400,
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!readingMode) e.currentTarget.style.background = t.surfaceHover; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!readingMode) e.currentTarget.style.background = t.surface; }}
          >
            {readingMode ? <AlignCenter size={14} /> : <AlignJustify size={14} />}
            <span>{readingMode ? "읽기" : "전체"}</span>
          </button>

          {!isShowcase && (
            <button
              onClick={handleResyncLinks}
              disabled={isResyncingLinks}
              title={resyncResult ? `링크 재동기화 완료 (${resyncResult.links_fixed}개 수정)` : "저장된 file:// 링크를 GitHub URL로 변환"}
              style={{ height: 36, padding: "0 10px", borderRadius: 10, background: resyncResult ? t.surfaceHover : t.surface, border: "none", cursor: isResyncingLinks ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 5, color: resyncResult?.links_fixed === -1 ? "#ef4444" : t.textSecondary, fontSize: 12, transition: "background 0.15s", opacity: isResyncingLinks ? 0.6 : 1 }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isResyncingLinks) e.currentTarget.style.background = t.surfaceHover; }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isResyncingLinks) e.currentTarget.style.background = resyncResult ? t.surfaceHover : t.surface; }}
            >
              <Link size={14} style={{ flexShrink: 0, animation: isResyncingLinks ? "spin 1s linear infinite" : "none" }} />
              <span>{isResyncingLinks ? "동기화 중..." : resyncResult ? `${resyncResult.links_fixed}개 수정됨` : "링크 재동기화"}</span>
            </button>
          )}

          {/* Per-project GitHub URL setting */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => { setGithubUrlDraft(customGithubUrl || (gitRoots?.[0]?.webUrl ?? '')); setShowGithubUrlEdit(v => !v); }}
              title={customGithubUrl ? `GitHub: ${customGithubUrl}` : "프로젝트 GitHub 저장소 URL 설정"}
              style={{ height: 36, padding: "0 10px", borderRadius: 10, background: customGithubUrl ? t.primaryLight : t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, color: customGithubUrl ? t.primary : t.textSecondary, fontSize: 12, transition: "background 0.15s" }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!customGithubUrl) e.currentTarget.style.background = t.surfaceHover; }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!customGithubUrl) e.currentTarget.style.background = t.surface; }}
            >
              <FaGithub size={14} />
              <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {customGithubUrl
                  ? customGithubUrl.replace('https://github.com/', '').replace('https://', '')
                  : gitRoots?.[0]?.webUrl
                    ? gitRoots[0].webUrl.replace('https://github.com/', '').replace('https://', '')
                    : "GitHub 설정"}
              </span>
            </button>
            {showGithubUrlEdit && (
              <div style={{
                position: "absolute", top: 44, right: 0, zIndex: 200,
                background: isDark ? "#1e1e24" : "#fff",
                border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"}`,
                borderRadius: 12, padding: 14, width: 340,
                boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    GitHub 저장소 URL
                  </span>
                  {customGithubUrl
                    ? <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: t.primaryLight, color: t.primary, fontWeight: 600 }}>직접 입력</span>
                    : autoDetectedGithubUrl
                      ? <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: isDark ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.1)", color: "#22c55e", fontWeight: 600 }}>자동 감지</span>
                      : null
                  }
                </div>
                {autoDetectedGithubUrl && !customGithubUrl && (
                  <div style={{ fontSize: 11, color: isDark ? "rgba(34,197,94,0.8)" : "#16a34a", marginBottom: 8, padding: "6px 8px", borderRadius: 6, background: isDark ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.06)" }}>
                    git remote에서 자동 감지됨: {autoDetectedGithubUrl.replace('https://github.com/', 'github.com/')}
                  </div>
                )}
                <input
                  autoFocus
                  type="text"
                  value={githubUrlDraft}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGithubUrlDraft(e.target.value)}
                  placeholder={autoDetectedGithubUrl || "https://github.com/owner/repo"}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') {
                      const url = githubUrlDraft.trim().replace(/\.git$/, '').replace(/\/$/, '');
                      setCustomGithubUrl(url);
                      if (githubUrlStorageKey) {
                        try { url ? localStorage.setItem(githubUrlStorageKey, url) : localStorage.removeItem(githubUrlStorageKey); } catch {}
                      }
                      if (url) {
                        setGitRoots([{ prefix: '', name: projectData?.repo || '', webUrl: url, branch: 'main' }]);
                      }
                      setShowGithubUrlEdit(false);
                    }
                    if (e.key === 'Escape') setShowGithubUrlEdit(false);
                  }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 10px", borderRadius: 8, fontSize: 12, fontFamily: "monospace",
                    background: isDark ? "#252530" : "#f5f5f7",
                    border: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"}`,
                    color: t.textSecondary, outline: "none",
                  }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      const url = githubUrlDraft.trim().replace(/\.git$/, '').replace(/\/$/, '');
                      setCustomGithubUrl(url);
                      if (githubUrlStorageKey) {
                        try { url ? localStorage.setItem(githubUrlStorageKey, url) : localStorage.removeItem(githubUrlStorageKey); } catch {}
                      }
                      if (url) {
                        setGitRoots([{ prefix: '', name: projectData?.repo || '', webUrl: url, branch: 'main' }]);
                      }
                      setShowGithubUrlEdit(false);
                    }}
                    style={{ flex: 1, padding: "6px 0", borderRadius: 8, background: t.primary, border: "none", cursor: "pointer", color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}
                  >
                    저장
                  </button>
                  {customGithubUrl && (
                    <button
                      onClick={() => {
                        setCustomGithubUrl('');
                        if (githubUrlStorageKey) try { localStorage.removeItem(githubUrlStorageKey); } catch {}
                        // Restore to auto-detected URL if available
                        if (autoDetectedGithubUrl) {
                          setGitRoots([{ prefix: '', name: projectData?.repo || '', webUrl: autoDetectedGithubUrl, branch: 'main' }]);
                        } else {
                          setGitRoots([]);
                        }
                        setShowGithubUrlEdit(false);
                      }}
                      style={{ padding: "6px 10px", borderRadius: 8, background: t.surface, border: "none", cursor: "pointer", color: t.textMuted, fontSize: 12, fontFamily: "inherit" }}
                    >
                      자동 감지로 복원
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 8 }}>
                  공개 프로젝트는 git remote에서 자동 감지됩니다.<br/>
                  사내/로컬 프로젝트만 직접 입력하세요.
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setShowTestScenarios((v) => !v)}
            title="테스트 시나리오 생성"
            style={{ height: 36, padding: "0 12px", borderRadius: 10, background: showTestScenarios ? '#f59e0b' : t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: showTestScenarios ? '#fff' : t.textSecondary, fontSize: 12, fontWeight: 600, transition: "background 0.15s", fontFamily: "inherit" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!showTestScenarios) e.currentTarget.style.background = t.surfaceHover; }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { if (!showTestScenarios) e.currentTarget.style.background = t.surface; }}
          >
            <FlaskConical size={15} />
            테스트 시나리오
          </button>

          <button
            onClick={onGoHome}
            title="홈으로"
            style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.textSecondary, transition: "background 0.15s" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surface)}
          >
            <Home size={16} />
          </button>

          <button
            onClick={onToggleTheme}
            title="테마"
            style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.textSecondary, transition: "background 0.15s" }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surface)}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Sidebar */}
        <div ref={sidebarRef} style={{ width: 236, flexShrink: 0, background: t.sidebarBg, padding: "12px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {tree.map((item) => (
            <TreeNode key={item.id} item={item} />
          ))}
        </div>

        {/* Test Scenario Panel */}
        {showTestScenarios && (
          <div style={{ width: 520, flexShrink: 0, borderLeft: `1px solid ${t.divider}`, overflowY: "auto" }}>
            <TestScenarioViewer
              isDark={isDark}
              flowId="all"
              flowName="Business Flows"
              scenarios={testScenarioResults}
              progress={testGenProgress ?? undefined}
              onGenerateScenarios={() => handleGenerateTestScenarios()}
            />
          </div>
        )}

        {/* Content */}
        <div
          ref={contentRef}
          onScroll={(e: React.UIEvent<HTMLDivElement>) => setShowScrollTop(e.currentTarget.scrollTop > 300)}
          style={{ flex: 1, overflowY: "auto", padding: "32px 0", position: "relative" }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedPage}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              style={{
                maxWidth: readingMode ? 820 : "100%",
                margin: readingMode ? "0 auto" : "0",
                padding: readingMode ? "0 40px" : "0 24px",
                transition: "max-width 0.25s ease, padding 0.25s ease",
              }}
            >
              {isLoading ? (
                 <div style={{ textAlign: "center", padding: "60px 20px", color: t.textMuted }}>위키 데이터를 불러오는 중...</div>
              ) : error ? (
                 <div style={{ textAlign: "center", padding: "60px 20px", color: "#f87171" }}>오류: {error}</div>
              ) : selectedPage ? (
                <article style={{ color: t.text, lineHeight: 1.7, position: "relative" }}>
                  {!isShowcase && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, paddingLeft: "2.5rem", paddingRight: "0.5rem" }}>
                    <div>
                      {brokenDiagrams.length > 0 && (
                        <button
                          onClick={handleFixAllDiagrams}
                          disabled={isBatchFixing}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: isBatchFixing ? t.surface : "#7c3aed", border: `1px solid ${isBatchFixing ? t.divider : "#7c3aed"}`, borderRadius: 8, color: isBatchFixing ? t.textSecondary : "#fff", fontSize: 13, cursor: isBatchFixing ? "default" : "pointer", transition: "all 0.15s" }}
                          title={`${projectData?.repo ?? ''} 위키 전체에서 렌더링되지 않는 다이어그램을 한 번에 복구합니다`}
                        >
                          <RefreshCw size={13} className={isBatchFixing ? "animate-spin" : ""} />
                          {isBatchFixing
                            ? `다이어그램 복구 중... (${batchFixProgress.current}/${batchFixProgress.total})`
                            : `다이어그램 전체 수정 (${brokenDiagrams.length})`}
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        onClick={handleGenerateBusiness}
                        disabled={isGeneratingBusiness}
                        title="비즈니스 분석(개요·데이터플로우·워크플로우·영향분석)을 생성하여 위키에 추가합니다"
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 8, color: t.textSecondary, fontSize: 13, cursor: isGeneratingBusiness ? "default" : "pointer", transition: "all 0.15s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!isGeneratingBusiness) { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.text; } }}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = t.surface; e.currentTarget.style.color = t.textSecondary; }}
                      >
                        <Sparkles size={13} className={isGeneratingBusiness ? "animate-pulse" : ""} />
                        {isGeneratingBusiness ? "비즈니스 분석 중..." : "비즈니스 분석 생성"}
                      </button>
                      <button
                        onClick={() => setShowRegenModal(true)}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 8, color: t.textSecondary, fontSize: 13, cursor: "pointer", transition: "all 0.15s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.text; }}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = t.surface; e.currentTarget.style.color = t.textSecondary; }}
                      >
                        <RefreshCw size={13} />
                        페이지 재생성 (Review)
                      </button>
                    </div>
                  </div>
                  )}
                  {isRegenerating ? (
                    <div style={{ textAlign: "center", padding: "60px 20px", color: t.primary }}>
                      <RefreshCw size={24} className="animate-spin" style={{ margin: "0 auto 12px auto" }} />
                      <p>AI가 피드백을 반영하여 페이지를 재생성 중입니다...</p>
                    </div>
                  ) : (
                    <Markdown
                      content={currentPage.content}
                      onFixDiagram={isShowcase ? undefined : handleFixDiagramStable}
                      onCodeChange={handleCodeChangeStable}
                      onBlockAction={isShowcase ? undefined : handleBlockAction}
                      repositoryBaseUrl={repositoryBaseUrl}
                      repoName={projectData?.repo}
                      gitRoots={gitRoots}
                      hoverBgColor={hoverBgColor}
                      onNavigateToPage={navigateToPageByTarget}
                      diagramEdgeData={diagramEdgeData}
                    />
                  )}
                </article>
              ) : (
                <div style={{ textAlign: "center", padding: "60px 20px" }}>
                  <p style={{ color: t.textMuted, fontSize: 14 }}>
                    이 페이지는 아직 생성되지 않았거나 비어있습니다.
                  </p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Scroll to Top */}
          {showScrollTop && (
            <button
              onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
              style={{
                position: "sticky",
                bottom: 24,
                float: "right",
                marginRight: 24,
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: t.primary,
                border: "none",
                color: "#fff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                zIndex: 10,
                transition: "opacity 0.2s, transform 0.2s",
              }}
              title="맨 위로"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>

        {/* Right ToC — isolated component, state changes don't re-render WikiViewer */}
        <TocPanel
          headings={tocHeadings}
          contentRef={contentRef}
          selectedPage={selectedPage}
          isDark={isDark}
        />

        <WikiAskPanel
          open={showAsk}
          onClose={() => setShowAsk(false)}
          isDark={isDark}
          wikiTitle={wikiStructure?.title || projectName}
          pages={
            wikiStructure?.pages && wikiStructure.pages.length
              ? wikiStructure.pages.map((p) => ({
                  id: p.id,
                  title: p.title,
                  content: generatedPages[p.id]?.content || p.content || "",
                }))
              : Object.values(generatedPages).map((p) => ({
                  id: p.id,
                  title: p.title,
                  content: p.content || "",
                }))
          }
          projectData={projectData}
          repoPath={repoPath}
          repoType={projectData?.repo_type}
          onCitationClick={(id) => { setSelectedPage(id); setShowSearch(false); }}
        />

      </div>

      {/* ── Search overlay ── */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ position: "fixed", inset: 0, background: t.overlay, backdropFilter: "blur(6px)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh", zIndex: 100 }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) { setShowSearch(false); setQuery(""); } }}
          >
            <motion.div
              initial={{ opacity: 0, y: -18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              style={{ width: 560, maxWidth: "calc(100vw - 40px)", background: t.bg, borderRadius: 20, boxShadow: t.floatingShadow, overflow: "hidden" }}
              onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
            >
              {/* Search input */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: `1px solid ${t.divider}` }}>
                <Search size={17} color={t.textSecondary} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  placeholder="문서 검색..."
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: t.text, fontSize: 15.5, fontFamily: "inherit", caretColor: t.primary }}
                />
                <button
                  onClick={() => { setShowSearch(false); setQuery(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted, display: "flex", lineHeight: 1 }}
                >
                  <X size={15} />
                </button>
              </div>

              {/* Results */}
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {query ? (
                  filtered.length > 0 ? (
                    filtered.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 18px", background: "none", border: "none", cursor: "pointer", color: t.text, fontSize: 14, fontFamily: "inherit", textAlign: "left", transition: "background 0.1s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = t.surfaceHover)}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.background = "none")}
                      >
                        <FileText size={15} color={t.textSecondary} />
                        {item.title}
                      </button>
                    ))
                  ) : (
                    <p style={{ padding: "24px 18px", color: t.textMuted, fontSize: 14, textAlign: "center", margin: 0 }}>
                      '{query}'에 대한 결과가 없어요
                    </p>
                  )
                ) : (
                  <div style={{ padding: "20px 18px" }}>
                    <p style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", margin: "0 0 8px" }}>모든 페이지</p>
                    {allPages.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "9px 10px", background: "none", border: "none", cursor: "pointer", color: t.textSecondary, fontSize: 13.5, fontFamily: "inherit", textAlign: "left", borderRadius: 8, transition: "background 0.1s" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.text; }}
                        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.textSecondary; }}
                      >
                        <FileText size={14} color={t.textMuted} />
                        {item.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Regeneration Modal */}
      <AnimatePresence>
        {showRegenModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: t.overlay, backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) setShowRegenModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              style={{ width: 500, background: t.bg, borderRadius: 16, padding: 24, boxShadow: t.floatingShadow }}
            >
              <h3 style={{ margin: "0 0 16px 0", color: t.text, fontSize: 18 }}>페이지 재생성 요청</h3>
              <p style={{ color: t.textSecondary, fontSize: 13, marginBottom: 16 }}>
                "{currentPage?.title}" 문서를 다시 생성합니다. 변경을 원하는 부분(언어, 다이어그램 등)을 입력해주세요. (선택사항)
              </p>
              <textarea
                ref={regenPromptRef}
                defaultValue={""}
                placeholder="예: 다이어그램 선이 겹치지 않게 LR 방향으로 그려줘, 모든 설명을 한국어로 바꿔줘 등"
                style={{ width: "100%", height: 100, background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 8, padding: 12, color: t.text, fontFamily: "inherit", fontSize: 14, resize: "none", outline: "none", marginBottom: 20 }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  onClick={() => setShowRegenModal(false)}
                  style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${t.divider}`, borderRadius: 8, color: t.text, cursor: "pointer" }}
                >
                  취소
                </button>
                <button
                  onClick={() => handleRegenerate()}
                  style={{ padding: "8px 16px", background: t.primary, border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <RefreshCw size={14} /> 재생성 시작
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export Modal */}
      <AnimatePresence>
        {showExportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, background: t.overlay, backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) setShowExportModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              style={{ width: 450, background: t.bg, borderRadius: 16, padding: 24, boxShadow: t.floatingShadow }}
            >
              <h3 style={{ margin: "0 0 16px 0", color: t.text, fontSize: 18 }}>위키 내보내기</h3>

              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, color: t.textSecondary, marginBottom: 8 }}>대상 플랫폼</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["notion", "obsidian", "markdown"] as const).map((tType) => (
                    <button
                      key={tType}
                      onClick={() => setExportTarget(tType)}
                      style={{
                        flex: 1, padding: "10px", borderRadius: 8, cursor: "pointer",
                        background: exportTarget === tType ? t.primaryLight : "transparent",
                        border: `1px solid ${exportTarget === tType ? t.primary : t.divider}`,
                        color: exportTarget === tType ? t.primary : t.text,
                        fontWeight: exportTarget === tType ? 600 : 400,
                        textTransform: "capitalize"
                      }}
                    >
                      {tType}
                    </button>
                  ))}
                </div>
              </div>

              {exportTarget === "notion" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: t.textSecondary, marginBottom: 4 }}>Notion API Key</label>
                    <input type="password" value={exportKey} onChange={e => setExportKey(e.target.value)} placeholder="secret_..." style={{ width: "100%", padding: "10px", borderRadius: 6, border: `1px solid ${t.divider}`, background: t.surface, color: t.text }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, color: t.textSecondary, marginBottom: 4 }}>Parent Page ID</label>
                    <input type="text" value={exportParentId} onChange={e => setExportParentId(e.target.value)} placeholder="e.g. 1234567890abcdef..." style={{ width: "100%", padding: "10px", borderRadius: 6, border: `1px solid ${t.divider}`, background: t.surface, color: t.text }} />
                  </div>
                </div>
              )}

              {exportTarget === "obsidian" && (
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 12, color: t.textSecondary, marginBottom: 4 }}>Vault 경로 (로컬 절대 경로)</label>
                  <input type="text" value={exportVault} onChange={e => setExportVault(e.target.value)} placeholder="~/Documents/MyVault/ProjectWiki" style={{ width: "100%", padding: "10px", borderRadius: 6, border: `1px solid ${t.divider}`, background: t.surface, color: t.text }} />
                </div>
              )}

              {exportTarget === "markdown" && (
                <div style={{ marginBottom: 20 }}>
                  <p style={{ color: t.textSecondary, fontSize: 13, marginBottom: 10 }}>다운로드 형태를 선택하세요.</p>
                  {([
                    { v: "single", label: "단일 Markdown 파일", desc: "전체 위키를 하나의 .md 파일로 병합" },
                    { v: "tree", label: "디렉토리 구조 (zip)", desc: "섹션/페이지 폴더 구조 그대로 .md 여러 개를 zip으로" },
                  ] as const).map(({ v, label, desc }) => (
                    <button
                      key={v}
                      onClick={() => setExportStructure(v)}
                      style={{
                        display: "block", width: "100%", textAlign: "left", marginBottom: 8,
                        padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                        background: exportStructure === v ? t.primaryLight : "transparent",
                        border: `1px solid ${exportStructure === v ? t.primary : t.divider}`,
                        color: exportStructure === v ? t.primary : t.text,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: exportStructure === v ? 600 : 500 }}>{label}</div>
                      <div style={{ fontSize: 11, color: t.textSecondary, marginTop: 2 }}>{desc}</div>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button
                  onClick={() => setShowExportModal(false)}
                  style={{ padding: "8px 16px", background: "transparent", border: `1px solid ${t.divider}`, borderRadius: 8, color: t.text, cursor: "pointer" }}
                >
                  취소
                </button>
                <button
                  onClick={handleExport}
                  disabled={isExporting}
                  style={{ padding: "8px 16px", background: t.primary, border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 6, opacity: isExporting ? 0.7 : 1 }}
                >
                  {isExporting ? "내보내는 중..." : "내보내기"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Scroll To Top Button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            style={{
              position: "absolute",
              bottom: 40,
              right: 40,
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: t.primary,
              color: "#fff",
              border: "none",
              boxShadow: "0 6px 16px rgba(0,0,0,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 100,
              transition: "transform 0.2s, background 0.2s",
            }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.transform = "translateY(-4px)";
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.transform = "translateY(0)";
            }}
            title="맨 위로 이동"
          >
            <ArrowUp size={24} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
