"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { FolderOpen, ChevronRight, Clock, Folder, Moon, Sun, Settings, ClipboardList, Trash2, FlaskConical } from "lucide-react";
import { getTheme } from "@/lib/theme";

interface ApiProcessedProject {
  id: string;
  owner: string;
  repo: string;
  name: string;
  repo_type: string;
  submittedAt: number;
  language: string;
  languages?: string[];
  model?: string;
}

interface InterruptedJob {
  job_id: string;
  project_id: string;
  owner: string;
  repo: string;
  language: string;
  model?: string;
  page_done: number;
  page_total: number;
  started_at: string;
  error?: string;
}

interface HomeScreenProps {
  isDark: boolean;
  onToggleTheme: () => void;
  onSelectProject: (path: string, testMode: boolean, enableBusiness: boolean, paths?: string[]) => void;
  onOpenWiki: (owner: string, repo: string, repo_type: string, language: string, languages?: string[], model?: string, id?: string) => void;
  onResumeProject?: (owner: string, repo: string, repo_type: string, language: string, parentJobId: string) => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  appSettings?: { model: string; language: string; setupComplete: boolean; provider?: string; mode?: string };
}

export function HomeScreen({ isDark, onToggleTheme, onSelectProject, onOpenWiki, onResumeProject, onOpenSettings, onOpenAdmin, appSettings }: HomeScreenProps) {
  const t = getTheme(isDark);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<boolean>(false);
  // Business analysis is always on by default — no opt-in checkbox.
  const [enableBusiness] = useState(true);
  const [projectPath, setProjectPath] = useState<string>("");

  const [recentProjects, setRecentProjects] = useState<ApiProcessedProject[]>([]);
  const [interruptedJobs, setInterruptedJobs] = useState<InterruptedJob[]>([]);
  const [resumingJobId, setResumingJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAgyAuthed, setIsAgyAuthed] = useState<boolean>(true);

  type CacheCheckState =
    | null
    | { status: 'checking' }
    | { status: 'done'; exists: true; valid: boolean; page_count: number; total_pages: number }
    | { status: 'done'; exists: false };
  const [cacheCheck, setCacheCheck] = useState<CacheCheckState>(null);
  const [pendingPaths, setPendingPaths] = useState<{ paths: string[]; primary: string; repo: string } | null>(null);

  const parseProjectPaths = (value: string) => (
    value
      .split(/[\n,;]+/)
      .map((path) => path.trim())
      .filter(Boolean)
  );

  useEffect(() => {
    if (appSettings?.provider === "antigravity" && (!appSettings.mode || appSettings.mode === "cli")) {
      fetch('http://localhost:8001/agent/auth/status')
        .then(r => r.json())
        .then(d => setIsAgyAuthed(d.authenticated))
        .catch(() => setIsAgyAuthed(false));
    } else {
      setIsAgyAuthed(true);
    }
  }, [appSettings?.provider, appSettings?.mode]);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const isShowcase = process.env.NEXT_PUBLIC_SHOWCASE_MODE === 'true';
        const url = isShowcase ? '/showcase-data/projects.json' : '/api/wiki/projects';
        const response = await fetch(url);
        if (response.ok) {
          const data: ApiProcessedProject[] = await response.json();
          // Group by owner + repo only — same project with different models = one card
          const grouped = data.reduce((acc, curr) => {
            const key = `${curr.owner}/${curr.repo}`;
            if (!acc[key]) {
              acc[key] = { ...curr, languages: [curr.language] };
            } else {
              if (!acc[key].languages!.includes(curr.language)) {
                acc[key].languages!.push(curr.language);
              }
              // Keep the latest run's data
              if (curr.submittedAt > acc[key].submittedAt) {
                acc[key].submittedAt = curr.submittedAt;
                acc[key].id = curr.id;
                acc[key].model = curr.model;
              }
            }
            return acc;
          }, {} as Record<string, ApiProcessedProject>);

          setRecentProjects(Object.values(grouped).sort((a, b) => b.submittedAt - a.submittedAt));
        } else {
          setRecentProjects([]);
        }
      } catch (err) {
        console.error("Failed to fetch projects", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchProjects();
  }, []);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_SHOWCASE_MODE === 'true') return;
    fetch('/api/wiki/interrupted-projects')
      .then(r => r.ok ? r.json() : [])
      .then((jobs: InterruptedJob[]) => setInterruptedJobs(jobs))
      .catch(() => setInterruptedJobs([]));
  }, []);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp); // submittedAt is already in ms
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const sanitizeRepoName = (path: string) => {
    const raw = path.replace(/\/+$/, '').split('/').pop() || 'project';
    return raw.replace(/[^a-zA-Z0-9가-힣\-_.]/g, '_').replace(/_+/g, '_').replace(/^[_.\-]+|[_.\-]+$/g, '') || 'project';
  };

  const handleStartWithCacheCheck = async () => {
    if (!isAgyAuthed) return;
    const paths = parseProjectPaths(projectPath);
    if (paths.length === 0) { alert("프로젝트 경로를 입력해주세요."); return; }
    const primary = paths[0];
    const repo = sanitizeRepoName(primary);
    const language = appSettings?.language || 'ko';

    setPendingPaths({ paths, primary, repo });
    setCacheCheck({ status: 'checking' });

    try {
      const params = new URLSearchParams({ owner: 'local', repo, repo_type: 'local', language });
      if (appSettings?.model) params.set('model', appSettings.model);
      const res = await fetch(`/api/wiki/cache-status?${params}`);
      const data = res.ok ? await res.json() : { exists: false };

      if (!data.exists) {
        setCacheCheck(null); setPendingPaths(null);
        onSelectProject(primary, testMode, enableBusiness, paths);
      } else {
        setCacheCheck({ status: 'done', ...data });
      }
    } catch {
      setCacheCheck(null); setPendingPaths(null);
      onSelectProject(primary, testMode, enableBusiness, paths);
    }
  };

  const handleOpenExistingWiki = () => {
    if (!pendingPaths) return;
    const language = appSettings?.language || 'ko';
    onOpenWiki('local', pendingPaths.repo, 'local', language, [language], appSettings?.model);
    setCacheCheck(null); setPendingPaths(null);
  };

  const handleGenerateNew = () => {
    if (!pendingPaths) return;
    onSelectProject(pendingPaths.primary, testMode, enableBusiness, pendingPaths.paths);
    setCacheCheck(null); setPendingPaths(null);
  };

  const handleResumeFromCache = async () => {
    if (!pendingPaths) return;
    const { primary, paths, repo } = pendingPaths;
    const language = appSettings?.language || 'ko';
    try {
      const params = new URLSearchParams({ owner: 'local', repo, repo_type: 'local', language });
      if (appSettings?.model) params.set('model', appSettings.model);
      const cacheRes = await fetch(`/api/wiki_cache?${params}`);
      if (!cacheRes.ok) { handleGenerateNew(); return; }
      const cacheData = await cacheRes.json();

      const generatedPages = cacheData.generated_pages || {};
      const completedPageIds = Object.entries(generatedPages)
        .filter(([, page]) => ((page as any)?.content || '').length >= 50)
        .map(([id]) => id);

      sessionStorage.setItem('localwiki_resume_pending', JSON.stringify({
        streamId: '',
        completedPageIds,
        wikiStructure: cacheData.wiki_structure || {},
        generatedPages,
      }));
      onSelectProject(primary, testMode, enableBusiness, paths);
    } catch {
      handleGenerateNew();
    }
    setCacheCheck(null); setPendingPaths(null);
  };

  const handleResumeJob = async (e: React.MouseEvent, job: InterruptedJob) => {
    e.stopPropagation();
    if (!onResumeProject) return;
    setResumingJobId(job.job_id);
    try {
      onResumeProject(job.owner, job.repo, 'local', job.language, job.job_id);
    } finally {
      setResumingJobId(null);
    }
  };

  const handleDismissJob = async (e: React.MouseEvent, jobId: string) => {
    e.stopPropagation();
    try {
      await fetch(`/api/wiki/interrupted-job?job_id=${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
    setInterruptedJobs(prev => prev.filter(j => j.job_id !== jobId));
  };

  const handleDeleteProject = async (e: React.MouseEvent, proj: ApiProcessedProject) => {
    e.stopPropagation();
    if (!confirm(`'${proj.repo}' 프로젝트 위키 데이터를 완전히 삭제하시겠습니까? (모든 언어 포함)`)) return;
    
    try {
      const langsToDelete = proj.languages && proj.languages.length > 0 ? proj.languages : [proj.language];
      
      const promises = langsToDelete.map(lang => {
        const params = new URLSearchParams({ owner: proj.owner, repo: proj.repo, repo_type: proj.repo_type, language: lang });
        if (proj.model) params.set('model', proj.model);
        return fetch(`/api/wiki_cache?${params}`, { method: 'DELETE' });
      });
      
      const results = await Promise.all(promises);
      const allOk = results.every(r => r.ok);
      
      if (allOk) {
        setRecentProjects(prev => prev.filter(p => p.id !== proj.id));
      } else {
        alert("일부 언어 캐시 삭제에 실패했습니다.");
        setRecentProjects(prev => prev.filter(p => p.id !== proj.id)); // 일단 UI에선 내림
      }
    } catch (err) {
      console.error("Failed to delete project", err);
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.35 }}
      style={{
        width: "100%",
        minHeight: "100dvh",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        overflowY: "auto",
        paddingTop: 80,
        paddingBottom: 60,
        position: "relative",
        fontFamily: "var(--font-sans), Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Top buttons */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 24,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        {/* Settings badge */}
        {appSettings?.setupComplete && (
          <div
            onClick={onOpenSettings}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              background: t.surface,
              borderRadius: 10,
              cursor: "pointer",
              border: `1px solid ${t.divider}`,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
          >
            <span style={{ fontSize: 11, color: t.text, fontWeight: 600 }}>
              {appSettings.model}
            </span>
            <span style={{ fontSize: 11, color: t.textMuted }}>·</span>
            <span style={{ fontSize: 11, color: t.textSecondary }}>한국어</span>
          </div>
        )}
        {!appSettings?.setupComplete && (
          <button
            onClick={onOpenSettings}
            style={{
              padding: "6px 14px",
              borderRadius: 10,
              background: t.primary,
              border: "none",
              cursor: "pointer",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ⚙️ 설정 필요
          </button>
        )}
        {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && onOpenSettings && (
          <button
            onClick={onOpenSettings}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: t.surface,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textSecondary,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
            title="설정"
          >
            <Settings size={18} />
          </button>
        )}
        {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && (
          <a
            href="/benchmark"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: t.surface,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textSecondary,
              transition: "background 0.2s",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
            title="Benchmark 비교"
          >
            <FlaskConical size={18} />
          </a>
        )}
        {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && onOpenAdmin && (
          <button
            onClick={onOpenAdmin}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: t.surface,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: t.textSecondary,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
            title="작업 기록 (Admin)"
          >
            <ClipboardList size={18} />
          </button>
        )}
        <button
          onClick={onToggleTheme}
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: t.surface,
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: t.textSecondary,
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>

      {/* Logo + headline */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 44 }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            background: "linear-gradient(145deg, #4096F7, #1A5FD4)",
            borderRadius: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 20,
            boxShadow: "0 8px 32px rgba(49,130,246,0.28)",
          }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M10 13h20M10 20h14M10 27h20" stroke="white" strokeWidth="2.8" strokeLinecap="round" />
            <circle cx="30" cy="27" r="5" fill="white" fillOpacity="0.92" />
            <path d="M28.5 27l1.3 1.3 2.4-2.6" stroke="#3182F6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

        <h1 style={{ color: t.text, fontSize: 32, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.5px", margin: "0 0 8px" }}>
          LocalWiki
        </h1>
        <p style={{ color: t.textSecondary, fontSize: 16, margin: 0 }}>
          프로젝트 폴더를 선택하면 위키를 자동으로 생성해 드려요
        </p>
      </motion.div>

      {/* Drop zone */}
      {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && (
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          onSelectProject("~/Projects/dropped-project", testMode, enableBusiness);
        }}
        style={{
          width: 480,
          maxWidth: "calc(100vw - 48px)",
          padding: "40px",
          borderRadius: 20,
          background: isDragging ? t.primaryLight : t.surface,
          border: `2px dashed ${isDragging ? t.primary : t.divider}`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          marginBottom: 28,
          transition: "all 0.2s ease",
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            background: t.primaryLight,
            borderRadius: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <FolderOpen size={30} color={t.primary} />
        </div>

        <p style={{ color: t.text, fontWeight: 600, fontSize: 15, margin: "0 0 6px" }}>
          프로젝트 폴더를 드래그하거나
        </p>
        <p style={{ color: t.textSecondary, fontSize: 14, margin: "0 0 16px", textAlign: "center", lineHeight: 1.6 }}>
          코드를 분석해 위키, 아키텍처 다이어그램, API 레퍼런스를 자동 생성합니다
        </p>

        <div style={{ width: '100%', marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: 13, color: t.textSecondary, fontWeight: 500 }}>
            프로젝트 폴더 절대 경로
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder={"예: /path/to/my-project\n복수 레포는 줄바꿈, 쉼표, 세미콜론으로 구분"}
              style={{
                flex: 1,
                padding: '12px 16px',
                minHeight: 46,
                resize: 'vertical',
                borderRadius: '12px',
                border: `1px solid ${t.divider}`,
                background: isDark ? "rgba(0,0,0,0.2)" : "#fff",
                color: t.text,
                fontSize: 14,
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => e.target.style.borderColor = t.primary}
              onBlur={(e) => e.target.style.borderColor = t.divider}
            />
            <button
              onClick={async () => {
                try {
                  const res = await fetch('/api/fs/select_folder');
                  const data = await res.json();
                  if (data && data.path) {
                    setProjectPath(data.path);
                  }
                } catch (e) {
                  console.error("Failed to select folder via API", e);
                  alert("폴더 선택 다이얼로그를 띄우는데 실패했습니다.");
                }
              }}
              style={{
                background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
                color: t.text,
                border: `1px solid ${t.divider}`,
                padding: '0 16px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}
              onMouseOut={(e) => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"}
            >
              찾아보기
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", marginBottom: "24px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: t.textSecondary, fontSize: 13 }}>
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} style={{ cursor: "pointer", accentColor: t.primary }} />
            빠른 테스트 모드
          </label>
          <span style={{ display: "flex", alignItems: "center", gap: "6px", color: t.textMuted, fontSize: 12 }}>
            ✓ 비즈니스 분석 기본 포함
          </span>
        </div>

        {/* Cache status panel — shown when cache found */}
        {cacheCheck?.status === 'done' && cacheCheck.exists && (
          <div style={{
            width: '100%', marginBottom: 16, padding: '12px 16px',
            borderRadius: 12, border: `1px solid ${cacheCheck.valid ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
            background: cacheCheck.valid ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.06)',
          }}>
            <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: t.text }}>
              {cacheCheck.valid
                ? `완성된 위키가 있어요 (${cacheCheck.page_count}페이지)`
                : `미완성 위키가 있어요 (${cacheCheck.page_count}/${cacheCheck.total_pages}페이지)`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {cacheCheck.valid ? (
                <>
                  <button onClick={handleOpenExistingWiki} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: 'rgba(34,197,94,0.15)', color: '#16a34a',
                    border: '1px solid rgba(34,197,94,0.3)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>기존 위키 보기</button>
                  <button onClick={handleGenerateNew} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: t.surface, color: t.textSecondary,
                    border: `1px solid ${t.divider}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>새로 생성</button>
                </>
              ) : (
                <>
                  <button onClick={handleResumeFromCache} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: 'rgba(245,158,11,0.15)', color: '#d97706',
                    border: '1px solid rgba(245,158,11,0.3)', cursor: 'pointer', fontFamily: 'inherit',
                  }}>이어서 생성</button>
                  <button onClick={handleGenerateNew} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                    background: t.surface, color: t.textSecondary,
                    border: `1px solid ${t.divider}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>처음부터 재생성</button>
                </>
              )}
              <button onClick={() => { setCacheCheck(null); setPendingPaths(null); }} style={{
                padding: '8px 12px', borderRadius: 10, fontSize: 13,
                background: 'transparent', color: t.textMuted,
                border: `1px solid ${t.divider}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>취소</button>
            </div>
          </div>
        )}

        <button
          onClick={cacheCheck?.status === 'done' && cacheCheck.exists ? undefined : handleStartWithCacheCheck}
          disabled={!isAgyAuthed || cacheCheck?.status === 'checking' || (cacheCheck?.status === 'done' && cacheCheck.exists)}
          style={{
            background: isAgyAuthed ? t.primary : t.divider,
            color: isAgyAuthed ? "white" : t.textMuted,
            padding: "13px 28px",
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 600,
            border: "none",
            cursor: isAgyAuthed ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: isAgyAuthed ? `0 4px 20px ${isDark ? "rgba(77,156,246,0.35)" : "rgba(49,130,246,0.3)"}` : "none",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            if (!isAgyAuthed) return;
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = `0 8px 28px ${isDark ? "rgba(77,156,246,0.45)" : "rgba(49,130,246,0.4)"}`;
          }}
          onMouseLeave={(e) => {
            if (!isAgyAuthed) return;
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = `0 4px 20px ${isDark ? "rgba(77,156,246,0.35)" : "rgba(49,130,246,0.3)"}`;
          }}
          title={!isAgyAuthed ? "설정(우측 상단 톱니바퀴)에서 구글 로그인을 먼저 진행해주세요" : ""}
        >
          <FolderOpen size={18} />
          {cacheCheck?.status === 'checking' ? '확인 중...' : '위키 생성 시작'}
        </button>
        {!isAgyAuthed && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12, fontWeight: 500 }}>
            ⚠️ Antigravity CLI 인증이 필요합니다. 우측 상단의 설정(⚙️)을 눌러 로그인해주세요.
          </p>
        )}
      </motion.div>
      )}

      {/* Recent projects */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.28, duration: 0.5 }}
        style={{ width: 480, maxWidth: "calc(100vw - 48px)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, paddingLeft: 4 }}>
          <Clock size={13} color={t.textMuted} />
          <span style={{ color: t.textMuted, fontSize: 12, letterSpacing: "0.2px" }}>최근 프로젝트</span>
        </div>

        <div style={{
          paddingRight: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          {isLoading ? (
             <div style={{ color: t.textMuted, padding: "12px", textAlign: "center", fontSize: 13 }}>로딩 중...</div>
          ) : (interruptedJobs.length === 0 && recentProjects.length === 0) ? (
             <div style={{ color: t.textMuted, padding: "12px", textAlign: "center", fontSize: 13 }}>최근 프로젝트가 없습니다.</div>
          ) : (
            <>
              {/* Interrupted jobs — resumable */}
              {interruptedJobs.map((job) => (
                <div
                  key={job.job_id}
                  onMouseEnter={() => setHoveredProject(job.job_id)}
                  onMouseLeave={() => setHoveredProject(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: hoveredProject === job.job_id ? t.surfaceHover : "transparent",
                    border: `1px solid rgba(245,158,11,0.25)`,
                    cursor: "default",
                    transition: "background 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, background: "rgba(245,158,11,0.12)",
                      borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <Folder size={18} color="#f59e0b" />
                    </div>
                    <div>
                      <div style={{ color: t.text, fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{job.repo}</div>
                      <div style={{ color: t.textMuted, fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{
                          background: "rgba(245,158,11,0.15)", color: "#d97706",
                          padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                        }}>
                          재개 가능
                        </span>
                        <span style={{ color: t.textMuted }}>
                          {job.page_done}/{job.page_total > 0 ? job.page_total : "?"} 페이지
                        </span>
                        {job.model && (
                          <span style={{
                            background: "rgba(99,102,241,0.15)", color: t.primary,
                            padding: "1px 5px", borderRadius: 4, fontSize: 10,
                          }}>
                            {job.model.replace("agy-", "").replace("claude-", "")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {onResumeProject && (
                      <button
                        onClick={(e) => handleResumeJob(e, job)}
                        disabled={resumingJobId === job.job_id}
                        style={{
                          background: "#f59e0b",
                          color: "#fff",
                          border: "none",
                          padding: "5px 10px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: resumingJobId === job.job_id ? "not-allowed" : "pointer",
                          opacity: resumingJobId === job.job_id ? 0.6 : 1,
                          fontFamily: "inherit",
                          transition: "opacity 0.15s",
                        }}
                      >
                        {resumingJobId === job.job_id ? "준비 중..." : "이어서 생성"}
                      </button>
                    )}
                    <button
                      onClick={(e) => handleDismissJob(e, job.job_id)}
                      title="항목 삭제"
                      style={{
                        background: "transparent",
                        border: "none",
                        color: t.textMuted,
                        cursor: "pointer",
                        padding: "4px 6px",
                        borderRadius: 6,
                        fontSize: 14,
                        lineHeight: 1,
                        transition: "color 0.15s",
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = t.text}
                      onMouseLeave={(e) => e.currentTarget.style.color = t.textMuted}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              {/* Completed projects */}
              {recentProjects.map((proj) => (
                <div
                  key={proj.id}
                  onClick={() => onOpenWiki(proj.owner, proj.repo, proj.repo_type, proj.languages?.[0] || proj.language, proj.languages, proj.model, proj.id)}
                  onMouseEnter={() => setHoveredProject(proj.id)}
                  onMouseLeave={() => setHoveredProject(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: hoveredProject === proj.id ? t.surfaceHover : "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s ease",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, background: t.surface,
                      borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <Folder size={18} color={t.textSecondary} />
                    </div>
                    <div>
                      <div style={{ color: t.text, fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{proj.repo}</div>
                      <div style={{ color: t.textMuted, fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                        <span>{proj.repo_type}</span>
                        {proj.model && (
                          <span style={{
                            background: "rgba(99, 102, 241, 0.15)", color: t.primary,
                            padding: "1px 5px", borderRadius: 4, fontSize: 10,
                          }}>
                            {proj.model.replace("agy-", "").replace("claude-", "")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <span style={{
                      background: "rgba(34,197,94,0.12)", color: "#16a34a",
                      padding: "1px 7px", borderRadius: 5, fontSize: 10, fontWeight: 600,
                    }}>완료</span>
                    <span style={{ color: t.textMuted, fontSize: 12 }}>{formatTime(proj.submittedAt)}</span>
                    {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && hoveredProject === proj.id ? (
                      <button
                        onClick={(e) => handleDeleteProject(e, proj)}
                        style={{
                          background: "transparent", border: "none", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          padding: 4, color: t.textMuted, transition: "color 0.2s",
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = "red"}
                        onMouseLeave={(e) => e.currentTarget.style.color = t.textMuted}
                        title="삭제"
                      >
                        <Trash2 size={15} />
                      </button>
                    ) : (
                      <ChevronRight size={15} color={t.textMuted} />
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
