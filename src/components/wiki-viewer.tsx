"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search, Moon, Sun, ChevronRight,
  FileText, Folder, FolderOpen, X, Home,
  AlignCenter, AlignJustify, RefreshCw,
} from "lucide-react";
import { getTheme } from "@/lib/theme";
import Markdown from "./Markdown";
import { regenerateWikiPage } from "@/lib/wiki-generator";

const APP_SETTINGS_KEY = "localwiki_app_settings";

interface ProjectData {
  owner: string;
  repo: string;
  repo_type: string;
  language: string;
  languages?: string[];
  model?: string;
}

interface WikiViewerProps {
  isDark: boolean;
  onToggleTheme: () => void;
  projectName: string;
  projectData: ProjectData | null;
  onGoHome: () => void;
}

interface TreeItem {
  id: string;
  title: string;
  icon: "file" | "folder";
  children?: TreeItem[];
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
}

interface WikiStructure {
  id: string;
  title: string;
  pages: WikiPage[];
  sections: WikiSection[];
  rootSections: string[];
}

export function WikiViewer({ isDark, onToggleTheme, projectName, projectData, onGoHome }: WikiViewerProps) {
  const t = getTheme(isDark);
  const [selectedPage, setSelectedPage] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [readingMode, setReadingMode] = useState(true); // 기본값: 읽기 모드 (노션처럼)
  const searchRef = useRef<HTMLInputElement>(null);
  
  const [currentLang, setCurrentLang] = useState(projectData?.language || "ko");

  // Dynamic state from backend
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeItem[]>([]);
  const [allPages, setAllPages] = useState<TreeItem[]>([]);
  const [generatedPages, setGeneratedPages] = useState<Record<string, WikiPage>>({});
  const [wikiStructure, setWikiStructure] = useState<WikiStructure | null>(null);

  // Regeneration state
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [brokenDiagrams, setBrokenDiagrams] = useState<{pageId: string, chartCode: string}[]>([]);
  const [isBatchFixing, setIsBatchFixing] = useState(false);
  const [batchFixProgress, setBatchFixProgress] = useState({ current: 0, total: 0 });
  const regenPromptRef = useRef<HTMLTextAreaElement>(null);

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
        const isShowcase = process.env.NEXT_PUBLIC_SHOWCASE_MODE === 'true';
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

          setTimeout(async () => {
            try {
              const mermaidModule = await import('mermaid');
              const mermaid = mermaidModule.default;
              mermaid.initialize({ startOnLoad: false });
              const broken = [];
              for (const [pageId, pageData] of Object.entries(cachedData.generated_pages)) {
                const content = (pageData as WikiPage).content;
                const matches = content.matchAll(/```(?:mermaid)\n([\s\S]*?)\n```/gi);
                for (const match of matches) {
                  const chartCode = match[1];
                  try {
                    await mermaid.parse(chartCode);
                  } catch (e) {
                    broken.push({ pageId, chartCode });
                  }
                }
              }
              setBrokenDiagrams(broken);
            } catch (e) {
              console.error("Failed to check diagrams:", e);
            }
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
                  const item: TreeItem = { id: page.id, title: page.title, icon: "file" };
                  children.push(item);
                  newAllPages.push(item);
                }
              }
            }
            
            return {
              id: section.id,
              title: section.title,
              icon: "folder",
              children
            };
          }

          for (const rootId of structure.rootSections) {
            const node = buildSection(rootId);
            if (node) newTree.push(node);
          }

          setTree(newTree);
          setExpanded(newExpanded);
          setAllPages(newAllPages);

          if (newAllPages.length > 0) {
            setSelectedPage(newAllPages[0].id);
          }
        } else {
          console.error("No valid wiki structure or pages found in the cached response.");
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }
    loadWiki();
  }, [projectData, currentLang]);

  const handleRegenerate = async (targetPageId?: string) => {
    if (!selectedPage || !projectData || !wikiStructure) return;
    const pageIdToFix = targetPageId || selectedPage;
    const currentPageData = generatedPages[pageIdToFix];
    if (!currentPageData) return;

    setIsRegenerating(true);
    setShowRegenModal(false);
    
    try {
      let apiKey = "";
      let mode = "api";
      let provider = "google";
      let model = "gemini-3.1-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            mode = (settings.useCli ?? true) ? "cli" : "api";
            provider = settings.provider || "google";
            model = settings.model || "gemini-3.1-flash";
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
          provider: "google",
          model: "local"
        })
      });

    } catch (err: any) {
      alert(`재생성 실패: ${err.message}`);
    } finally {
      setIsRegenerating(false);
      if (regenPromptRef.current) regenPromptRef.current.value = "";
    }
  };

  const handleFixDiagram = async (chartCode: string, customInstruction?: string, targetPageId?: string) => {
    if (!selectedPage || !projectData || !wikiStructure) return;
    const currentPageData = generatedPages[selectedPage];
    if (!currentPageData) return;

    try {
      const fixPrompt = customInstruction
        ? `Modify the following Mermaid diagram according to the user's instruction.
User Instruction: ${customInstruction}
Output ONLY the modified diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.

Original Diagram:
\`\`\`mermaid
${chartCode}
\`\`\``
        : `The following Mermaid diagram has a syntax error.
Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.

Original Diagram:
\`\`\`mermaid
${chartCode}
\`\`\``;

      let apiKey = "";
      let useCli = true;
      let cliTool = "gemini";
      let provider = "google";
      let model = "gemini-3.1-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            useCli = settings.useCli ?? true;
            cliTool = settings.provider === "google" ? "gemini" : settings.provider === "anthropic" ? "claude" : settings.provider === "antigravity" ? "antigravity" : "codex";
            provider = settings.provider || "google";
            model = settings.model || "gemini-3.1-flash";
          } catch (e) {}
        }
      }

      const pageReqBody = {
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

      const fixResp = await fetch(`/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pageReqBody)
      });

      if (!fixResp.ok) throw new Error("API 요청 실패");

      let fixedContent = '';
      const decoder = new TextDecoder();
      if (fixResp.body) {
        const reader = fixResp.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fixedContent += decoder.decode(value, { stream: true });
        }
        fixedContent += decoder.decode();
      }

      const match = fixedContent.match(/```mermaid\n([\s\S]*?)\n```/i) || fixedContent.match(/```\n([\s\S]*?)\n```/i);
      let newDiagramCode = match ? match[1] : fixedContent.trim();
      newDiagramCode = newDiagramCode.replace(/^```(mermaid)?\n/i, '').replace(/\n```$/, '').trim();

      if (newDiagramCode) {
        const newPageContent = currentPageData.content.replace(chartCode, newDiagramCode);
        if (newPageContent === currentPageData.content) {
          throw new Error("문서 내에서 해당 다이어그램 원본을 찾지 못했습니다.");
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
            provider: "google",
            model: "local"
          })
        });
      } else {
        throw new Error("LLM 응답에서 다이어그램 코드를 추출하지 못했습니다.");
      }
    } catch (e: any) {
      alert(`다이어그램 복구 실패: ${e.message}`);
      throw e;
    }

  const handleFixAllDiagrams = async () => {
    if (brokenDiagrams.length === 0 || !projectData || !wikiStructure) return;
    setIsBatchFixing(true);
    setBatchFixProgress({ current: 0, total: brokenDiagrams.length });

    try {
      let currentGeneratedPages = { ...generatedPages };
      
      let apiKey = ""; let useCli = true; let cliTool = "gemini"; let provider = "google"; let model = "gemini-3.1-flash";
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(APP_SETTINGS_KEY);
        if (raw) {
          try {
            const settings = JSON.parse(raw);
            apiKey = settings.apiKey || "";
            useCli = settings.useCli ?? true;
            cliTool = settings.provider === "google" ? "gemini" : settings.provider === "anthropic" ? "claude" : settings.provider === "antigravity" ? "antigravity" : "codex";
            provider = settings.provider || "google";
            model = settings.model || "gemini-3.1-flash";
          } catch (e) {}
        }
      }

      for (let i = 0; i < brokenDiagrams.length; i++) {
        const { pageId, chartCode } = brokenDiagrams[i];
        setBatchFixProgress({ current: i + 1, total: brokenDiagrams.length });
        
        const fixPrompt = `The following Mermaid diagram has a syntax error.
Fix the syntax error (e.g. unescaped parentheses, quotes in IDs, newline chars). Output ONLY the corrected diagram inside a \`\`\`mermaid ... \`\`\` block. Do not add any conversational text.

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
            const newPageContent = oldContent.replace(chartCode, newDiagramCode);
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
          provider: "google",
          model: "local"
        })
      });
      setBrokenDiagrams([]);
      alert(`성공적으로 ${brokenDiagrams.length}개의 다이어그램 오류를 복구했습니다.`);
    } catch (e: any) {
      alert(`다이어그램 일괄 복구 실패: ${e.message}`);
    } finally {
      setIsBatchFixing(false);
    }
  };
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

  const navigate = (id: string) => {
    setSelectedPage(id);
    setActiveSection("");
    setShowSearch(false);
    setQuery("");
  };

  function TreeNode({ item, depth = 0 }: { item: TreeItem; depth?: number }) {
    const isSelected = selectedPage === item.id;
    const isExpanded = expanded.has(item.id);
    const isFolder = item.icon === "folder";

    return (
      <div>
        <button
          onClick={() => (isFolder ? toggleFolder(item.id) : navigate(item.id))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            width: "100%",
            padding: `7px 10px 7px ${14 + depth * 14}px`,
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
          onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = t.surfaceHover; }}
          onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
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

        {isFolder && item.children && (
          <div style={{ overflow: "hidden", maxHeight: isExpanded ? 2000 : 0, opacity: isExpanded ? 1 : 0, transition: "max-height 0.22s ease, opacity 0.18s ease" }}>
            {item.children.map((child) => (
              <TreeNode key={child.id} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const filtered = allPages.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));
  const currentPage = generatedPages[selectedPage];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
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
      <div style={{
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
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ width: 28, height: 28, background: "linear-gradient(145deg, #4096F7, #1A5FD4)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 40 40" fill="none">
                <path d="M10 13h20M10 20h14M10 27h20" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
              </svg>
            </div>
            LocalWiki
          </button>

          <ChevronRight size={13} color={t.textMuted} />
          <span style={{ color: t.textSecondary, fontSize: 13 }}>{projectName}</span>
        </div>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>


          <button
            onClick={() => { setShowSearch(true); setTimeout(() => searchRef.current?.focus(), 40); }}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", color: t.textMuted, fontSize: 12, fontFamily: "inherit", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
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
            onMouseEnter={(e) => { if (!readingMode) e.currentTarget.style.background = t.surfaceHover; }}
            onMouseLeave={(e) => { if (!readingMode) e.currentTarget.style.background = t.surface; }}
          >
            {readingMode ? <AlignCenter size={14} /> : <AlignJustify size={14} />}
            <span>{readingMode ? "읽기" : "전체"}</span>
          </button>

          <button
            onClick={onGoHome}
            title="홈으로"
            style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.textSecondary, transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
          >
            <Home size={16} />
          </button>

          <button
            onClick={onToggleTheme}
            title="테마"
            style={{ width: 36, height: 36, borderRadius: 10, background: t.surface, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: t.textSecondary, transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
          >
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Sidebar */}
        <div style={{ width: 236, flexShrink: 0, background: t.sidebarBg, padding: "12px 10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {tree.map((item) => (
            <TreeNode key={item.id} item={item} />
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 0" }}>
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
              ) : currentPage ? (
                <article style={{ color: t.text, lineHeight: 1.7, position: "relative" }}>
                  {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                    <button
                      onClick={() => setShowRegenModal(true)}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 8, color: t.textSecondary, fontSize: 13, cursor: "pointer", transition: "all 0.15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.text; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = t.surface; e.currentTarget.style.color = t.textSecondary; }}
                    >
                      <RefreshCw size={13} />
                      페이지 재생성 (Review)
                    </button>
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
                      onFixDiagram={process.env.NEXT_PUBLIC_SHOWCASE_MODE === 'true' ? undefined : (chartCode, customPrompt) => handleFixDiagram(chartCode, customPrompt, selectedPage)} 
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
        </div>

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
            onClick={(e) => { if (e.target === e.currentTarget) { setShowSearch(false); setQuery(""); } }}
          >
            <motion.div
              initial={{ opacity: 0, y: -18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.97 }}
              transition={{ duration: 0.2 }}
              style={{ width: 560, maxWidth: "calc(100vw - 40px)", background: t.bg, borderRadius: 20, boxShadow: t.floatingShadow, overflow: "hidden" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Search input */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", borderBottom: `1px solid ${t.divider}` }}>
                <Search size={17} color={t.textSecondary} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
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
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
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
                        onMouseEnter={(e) => { e.currentTarget.style.background = t.surfaceHover; e.currentTarget.style.color = t.text; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = t.textSecondary; }}
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
            onClick={(e) => { if (e.target === e.currentTarget) setShowRegenModal(false); }}
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
                  onClick={handleRegenerate}
                  style={{ padding: "8px 16px", background: t.primary, border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <RefreshCw size={14} /> 재생성 시작
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
