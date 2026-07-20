"use client";

import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import { FolderOpen, ChevronRight, Clock, Folder, Moon, Sun, Settings, ClipboardList, Trash2, FlaskConical, Loader2, ShieldCheck, CircleAlert, Bot, Plus, Send, Activity, BookOpen, ListTree, Shield, CheckCircle2 } from "lucide-react";
import { getTheme } from "@/lib/theme";
import { BACKEND_URL } from "@/lib/backend-url";
import { openPrivacySettings, probeFolderAccess, selectProjectFolder } from "@/lib/desktop-folder-picker";
import { RepoLumeMark } from "@/components/repolume-mark";

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
  slug?: string;
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
  onSelectProject: (path: string, testMode: boolean, enableBusiness: boolean, paths?: string[], businessFlowOnly?: boolean) => void;
  onOpenWiki: (owner: string, repo: string, repo_type: string, language: string, languages?: string[], model?: string, id?: string, slug?: string) => void;
  onResumeProject?: (owner: string, repo: string, repo_type: string, language: string, parentJobId: string) => void;
  onOpenSettings?: () => void;
  onOpenAdmin?: () => void;
  appSettings?: { model: string; language: string; setupComplete: boolean; provider?: string; mode?: string; preauthorizedPath?: string };
}

export function HomeScreen({ isDark, onToggleTheme, onSelectProject, onOpenWiki, onResumeProject, onOpenSettings, onOpenAdmin, appSettings }: HomeScreenProps) {
  const t = getTheme(isDark);
  const prefersReducedMotion = useReducedMotion();
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<boolean>(false);
  const [businessFlowOnly, setBusinessFlowOnly] = useState<boolean>(false);
  // Business analysis is always on by default — no opt-in checkbox.
  const [enableBusiness] = useState(true);
  const [projectPath, setProjectPath] = useState<string>("");
  const [isSelectingFolder, setIsSelectingFolder] = useState(false);
  const [folderAccess, setFolderAccess] = useState<null | {
    status: 'checking' | 'ready' | 'denied';
    name?: string;
    error?: string | null;
    summary?: string;
  }>(null);
  const [verifiedPathKey, setVerifiedPathKey] = useState("");

  const [recentProjects, setRecentProjects] = useState<ApiProcessedProject[]>([]);
  const [interruptedJobs, setInterruptedJobs] = useState<InterruptedJob[]>([]);
  const [resumingJobId, setResumingJobId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAgyAuthed, setIsAgyAuthed] = useState<boolean>(true);

  useEffect(() => {
    if (!projectPath && appSettings?.preauthorizedPath) {
      setProjectPath(appSettings.preauthorizedPath);
      void verifyFolder(appSettings.preauthorizedPath);
    }
  }, [appSettings?.preauthorizedPath]);

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
  const pathKey = (paths: string[]) => paths.map((path) => path.replace(/[\\/]+$/, "")).join("\n");
  const currentPaths = parseProjectPaths(projectPath);
  const permissionReady = folderAccess?.status === "ready"
    && verifiedPathKey === pathKey(currentPaths)
    && currentPaths.length > 0;

  useEffect(() => {
    if (appSettings?.provider === "antigravity" && (!appSettings.mode || appSettings.mode === "cli")) {
      fetch(`${BACKEND_URL}/agent/auth/status`)
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

  const verifyFolders = async (paths: string[]) => {
    if (paths.length === 0) return false;
    setFolderAccess({ status: 'checking' });
    setVerifiedPathKey("");
    let directoryCount = 0;
    let fileCount = 0;
    for (const path of paths) {
      const result = await probeFolderAccess(path);
      if (!result.readable) {
        setFolderAccess({ status: 'denied', name: result.name, error: result.error });
        return false;
      }
      directoryCount += result.directoriesChecked;
      fileCount += result.filesChecked;
    }
    setVerifiedPathKey(pathKey(paths));
    setFolderAccess({
      status: 'ready',
      name: paths.length === 1 ? paths[0].replace(/[\\/]+$/, '').split(/[\\/]/).pop() : `${paths.length}개 프로젝트`,
      summary: `${directoryCount.toLocaleString()}개 폴더 · ${fileCount.toLocaleString()}개 파일 표본 확인`,
    });
    return true;
  };

  const verifyFolder = (path: string) => verifyFolders([path]);

  const handlePermissionCheck = async () => {
    const paths = parseProjectPaths(projectPath);
    if (paths.length === 0) {
      setFolderAccess({ status: 'denied', error: '프로젝트 경로를 먼저 입력해 주세요.' });
      return;
    }
    await verifyFolders(paths);
  };

  const handleBrowseFolder = async () => {
    if (isSelectingFolder) return;
    setIsSelectingFolder(true);
    try {
      const selection = await selectProjectFolder();
      if (selection.cancelled) return;
      setProjectPath(selection.path);
      await verifyFolder(selection.path);
    } catch (error) {
      setFolderAccess({
        status: 'denied',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSelectingFolder(false);
    }
  };

  const handleStartWithCacheCheck = async () => {
    if (!isAgyAuthed) return;
    const paths = parseProjectPaths(projectPath);
    if (paths.length === 0) { alert("프로젝트 경로를 입력해주세요."); return; }
    const primary = paths[0];
    if (!permissionReady || verifiedPathKey !== pathKey(paths)) return;
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
        onSelectProject(primary, testMode, enableBusiness, paths, businessFlowOnly);
      } else {
        setCacheCheck({ status: 'done', ...data });
      }
    } catch {
      setCacheCheck(null); setPendingPaths(null);
      onSelectProject(primary, testMode, enableBusiness, paths, businessFlowOnly);
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
    onSelectProject(pendingPaths.primary, testMode, enableBusiness, pendingPaths.paths, businessFlowOnly);
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

      sessionStorage.setItem('repolume_resume_pending', JSON.stringify({
        streamId: '',
        completedPageIds,
        wikiStructure: cacheData.wiki_structure || {},
        generatedPages,
      }));
      onSelectProject(primary, testMode, enableBusiness, paths, businessFlowOnly);
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

  const renderLegacyHome = () => (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -16 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.35 }}
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
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={prefersReducedMotion
          ? { duration: 0 }
          : { delay: 0.08, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 44 }}
      >
        <div style={{ marginBottom: 20, filter: "drop-shadow(0 10px 18px rgba(79,70,229,.24))" }}>
          <RepoLumeMark size={80} />
        </div>

        <h1 style={{ color: t.text, fontSize: 32, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.5px", margin: "0 0 8px" }}>
          RepoLume
        </h1>
        <p style={{ color: t.textSecondary, fontSize: 16, margin: 0 }}>
          프로젝트 폴더를 선택하면 위키를 자동으로 생성해 드려요
        </p>
      </motion.div>

      {/* Drop zone */}
      {process.env.NEXT_PUBLIC_SHOWCASE_MODE !== 'true' && (
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={prefersReducedMotion
          ? { duration: 0 }
          : { delay: 0.16, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const droppedPath = (e.dataTransfer.files[0] as (File & { path?: string }) | undefined)?.path;
          if (!droppedPath) {
            setFolderAccess({ status: 'denied', error: '드래그한 폴더 경로를 확인할 수 없습니다. 찾아보기를 사용해 주세요.' });
            return;
          }
          setProjectPath(droppedPath);
          void verifyFolder(droppedPath);
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
              onChange={(e) => {
                setProjectPath(e.target.value);
                setFolderAccess(null);
                setVerifiedPathKey("");
              }}
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
              onClick={handleBrowseFolder}
              disabled={isSelectingFolder}
              aria-busy={isSelectingFolder}
              style={{
                background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)",
                color: t.text,
                border: `1px solid ${t.divider}`,
                padding: '0 16px',
                borderRadius: '12px',
                cursor: isSelectingFolder ? 'wait' : 'pointer',
                fontWeight: 600,
                fontSize: 14,
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}
              onMouseOut={(e) => e.currentTarget.style.background = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.05)"}
            >
              {isSelectingFolder ? '여는 중...' : '찾아보기'}
            </button>
            <button onClick={() => void handlePermissionCheck()} disabled={!projectPath.trim() || folderAccess?.status === 'checking'} style={{ border: `1px solid ${t.primary}`, borderRadius: 12, padding: '0 14px', background: t.primaryLight, color: t.primary, fontWeight: 650, cursor: !projectPath.trim() || folderAccess?.status === 'checking' ? 'not-allowed' : 'pointer' }}>권한 확인</button>
          </div>
          {folderAccess && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex', alignItems: 'center', gap: 7, marginTop: 9,
                color: folderAccess.status === 'denied' ? '#dc2626' : folderAccess.status === 'ready' ? '#16a34a' : t.textMuted,
                fontSize: 12,
              }}
            >
              {folderAccess.status === 'checking' && <Loader2 size={14} className="animate-spin" />}
              {folderAccess.status === 'ready' && <ShieldCheck size={14} />}
              {folderAccess.status === 'denied' && <CircleAlert size={14} />}
              <span>
                {folderAccess.status === 'checking' && '폴더 읽기 권한을 확인하고 있습니다.'}
                {folderAccess.status === 'ready' && `${folderAccess.name} 폴더 접근이 준비되었습니다. ${folderAccess.summary || ''}`}
                {folderAccess.status === 'denied' && `폴더를 읽을 수 없습니다: ${folderAccess.error || '권한을 확인해 주세요.'}`}
              </span>
              {folderAccess.status === 'denied' && <button onClick={() => void openPrivacySettings()} style={{ marginLeft: 'auto', border: `1px solid ${t.divider}`, borderRadius: 8, background: t.surface, color: t.textSecondary, padding: '5px 8px', fontSize: 11, cursor: 'pointer' }}>시스템 설정 열기</button>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: t.textSecondary, fontSize: 13 }}>
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} style={{ cursor: "pointer", accentColor: t.primary }} />
            빠른 테스트 모드
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", color: t.textSecondary, fontSize: 13 }}>
            <input type="checkbox" checked={businessFlowOnly} onChange={(e) => setBusinessFlowOnly(e.target.checked)} style={{ cursor: "pointer", accentColor: "#f59e0b" }} />
            ⚗️ 비즈니스 플로우만
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
          disabled={!isAgyAuthed || !permissionReady || cacheCheck?.status === 'checking' || (cacheCheck?.status === 'done' && cacheCheck.exists)}
          style={{
            background: isAgyAuthed && permissionReady ? t.primary : t.divider,
            color: isAgyAuthed && permissionReady ? "white" : t.textMuted,
            padding: "13px 28px",
            borderRadius: 14,
            fontSize: 15,
            fontWeight: 600,
            border: "none",
            cursor: isAgyAuthed && permissionReady ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: isAgyAuthed && permissionReady ? `0 4px 20px ${isDark ? "rgba(77,156,246,0.35)" : "rgba(49,130,246,0.3)"}` : "none",
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
            fontFamily: "inherit",
          }}
          onMouseEnter={(e) => {
            if (!isAgyAuthed || !permissionReady) return;
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow = `0 8px 28px ${isDark ? "rgba(77,156,246,0.45)" : "rgba(49,130,246,0.4)"}`;
          }}
          onMouseLeave={(e) => {
            if (!isAgyAuthed || !permissionReady) return;
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
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={prefersReducedMotion ? { duration: 0 } : { delay: 0.28, duration: 0.5 }}
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
                  onClick={() => onOpenWiki(proj.owner, proj.repo, proj.repo_type, proj.languages?.[0] || proj.language, proj.languages, proj.model, proj.id, proj.slug)}
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

  return (
    <div
      style={{
        "--home-bg": t.bg,
        "--home-surface": t.surface,
        "--home-hover": t.surfaceHover,
        "--home-divider": t.divider,
        "--home-text": t.text,
        "--home-secondary": t.textSecondary,
        "--home-muted": t.textMuted,
        "--home-primary": t.primary,
        width: "100%",
        height: "100dvh",
        background: t.bg,
        color: t.text,
        display: "grid",
        gridTemplateRows: "56px minmax(0, 1fr)",
        fontFamily: "var(--font-sans), Pretendard, -apple-system, BlinkMacSystemFont, sans-serif",
      } as React.CSSProperties}
    >
      <style>{`
        .repolume-home-body { display:grid; grid-template-columns:240px minmax(0,1fr) 280px; min-height:0; }
        .repolume-home-sidebar { min-height:0; overflow:auto; }
        .repolume-home-main { min-width:0; overflow:auto; }
        @media (max-width: 1080px) { .repolume-home-body { grid-template-columns:220px minmax(0,1fr); } .repolume-home-inspector { display:none !important; } }
        @media (max-width: 760px) { .repolume-home-body { display:block; overflow:auto; } .repolume-home-sidebar { display:none !important; } .repolume-home-main { overflow:visible; } }
      `}</style>

      <header style={{ height: 56, borderBottom: `1px solid ${t.divider}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px 0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RepoLumeMark size={30} />
          <div><div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.2px" }}>RepoLume</div><div style={{ fontSize: 10, color: t.textMuted }}>Local-first wiki generator</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {appSettings?.setupComplete && <button onClick={onOpenSettings} style={{ height: 32, padding: "0 11px", borderRadius: 9, border: `1px solid ${t.divider}`, background: t.surface, color: t.textSecondary, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{appSettings.model} · {appSettings.language.toUpperCase()}</button>}
          {onOpenAdmin && <button onClick={onOpenAdmin} title="작업 기록" style={{ width: 34, height: 34, borderRadius: 9, border: 0, background: t.surface, color: t.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Activity size={16} /></button>}
          <button onClick={onOpenSettings} title="설정" style={{ width: 34, height: 34, borderRadius: 9, border: 0, background: t.surface, color: t.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><Settings size={16} /></button>
          <button onClick={onToggleTheme} title="테마 전환" style={{ width: 34, height: 34, borderRadius: 9, border: 0, background: t.surface, color: t.textSecondary, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{isDark ? <Sun size={16} /> : <Moon size={16} />}</button>
        </div>
      </header>

      <div className="repolume-home-body">
        <aside className="repolume-home-sidebar" style={{ borderRight: `1px solid ${t.divider}`, padding: 12, display: "flex", flexDirection: "column" }}>
          <button onClick={() => { setProjectPath(""); setFolderAccess(null); setCacheCheck(null); }} style={{ height: 38, borderRadius: 10, background: t.primary, color: "#fff", border: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 650, cursor: "pointer" }}><Plus size={15} /> 새 분석</button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "18px 8px 8px", color: t.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase" }}><Clock size={12} /> 작업 기록</div>
          <div style={{ display: "grid", gap: 3 }}>
            {isLoading && <div style={{ padding: 12, color: t.textMuted, fontSize: 12 }}>불러오는 중...</div>}
            {interruptedJobs.map((job) => (
              <div key={job.job_id} style={{ padding: "9px 10px", borderRadius: 9, border: `1px solid rgba(245,158,11,.25)`, background: hoveredProject === job.job_id ? t.surfaceHover : "transparent" }} onMouseEnter={() => setHoveredProject(job.job_id)} onMouseLeave={() => setHoveredProject(null)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><CircleAlert size={14} color="#d97706" /><span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.repo}</span></div>
                <div style={{ margin: "5px 0 7px 22px", color: t.textMuted, fontSize: 10 }}>{job.page_done}/{job.page_total || "?"} 페이지 · 재개 가능</div>
                <div style={{ display: "flex", gap: 5, marginLeft: 22 }}><button onClick={(event) => handleResumeJob(event, job)} disabled={resumingJobId === job.job_id} style={{ border: 0, borderRadius: 6, padding: "4px 7px", background: "rgba(245,158,11,.14)", color: "#d97706", fontSize: 10, fontWeight: 650, cursor: "pointer" }}>이어서 생성</button><button onClick={(event) => handleDismissJob(event, job.job_id)} style={{ border: 0, background: "transparent", color: t.textMuted, fontSize: 10, cursor: "pointer" }}>숨기기</button></div>
              </div>
            ))}
            {recentProjects.map((project) => (
              <button key={project.id} onClick={() => onOpenWiki(project.owner, project.repo, project.repo_type, project.languages?.[0] || project.language, project.languages, project.model, project.id, project.slug)} onMouseEnter={() => setHoveredProject(project.id)} onMouseLeave={() => setHoveredProject(null)} style={{ width: "100%", border: 0, borderRadius: 9, padding: "9px 8px", background: hoveredProject === project.id ? t.surfaceHover : "transparent", color: t.text, display: "flex", alignItems: "center", gap: 9, textAlign: "left", cursor: "pointer" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: t.surface, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Folder size={14} color={t.textSecondary} /></div>
                <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.repo}</div><div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>{project.model?.replace("agy-", "") || project.repo_type}</div></div>
                {hoveredProject === project.id && process.env.NEXT_PUBLIC_SHOWCASE_MODE !== "true" ? <span onClick={(event) => { event.stopPropagation(); void handleDeleteProject(event as any, project); }} style={{ padding: 4, color: t.textMuted }}><Trash2 size={13} /></span> : <ChevronRight size={13} color={t.textMuted} />}
              </button>
            ))}
            {!isLoading && interruptedJobs.length === 0 && recentProjects.length === 0 && <div style={{ padding: "16px 10px", color: t.textMuted, fontSize: 11, lineHeight: 1.5 }}>완료된 작업과 재개할 작업이 여기에 표시됩니다.</div>}
          </div>
          <div style={{ marginTop: "auto", paddingTop: 16 }}><a href="/benchmark" style={{ height: 34, borderRadius: 8, color: t.textSecondary, display: "flex", alignItems: "center", gap: 8, padding: "0 9px", textDecoration: "none", fontSize: 11 }}><FlaskConical size={14} /> 품질 벤치마크</a></div>
        </aside>

        <main className="repolume-home-main" style={{ background: isDark ? t.bg : "#fbfcfe" }}>
          <div style={{ width: "min(820px, calc(100% - 36px))", margin: "0 auto", padding: "54px 0 80px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 24 }}><BookOpen size={16} color={t.primary} /><span style={{ fontSize: 11, color: t.textMuted, fontWeight: 700, letterSpacing: ".5px" }}>새 위키 만들기</span></div>
            <div role="log" aria-label="분석 대화" style={{ display: "grid", gap: 18 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 10, background: t.primary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Bot size={17} color="#fff" /></div>
                <div style={{ maxWidth: 640 }}><h1 style={{ margin: "2px 0 7px", fontSize: 23, lineHeight: 1.25, letterSpacing: "-.45px" }}>어떤 코드베이스를 문서화할까요?</h1><p style={{ margin: 0, color: t.textSecondary, fontSize: 13, lineHeight: 1.7 }}>프로젝트를 선택하면 구조를 분석하고, 생성할 목차를 먼저 제안합니다. 승인 전에는 본문 생성을 시작하지 않으며 모든 작업 로그와 실패 항목을 대화 흐름에 남깁니다.</p></div>
              </div>

              <section style={{ marginLeft: 44, border: `1px solid ${t.divider}`, borderRadius: 16, background: t.surface, boxShadow: isDark ? "none" : "0 10px 30px rgba(15,23,42,.05)", overflow: "hidden" }}>
                <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.divider}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 8, color: t.text, fontSize: 12, fontWeight: 650 }}><FolderOpen size={15} color={t.primary} /> 분석 대상</div><span style={{ fontSize: 10, color: t.textMuted }}>로컬 폴더 · 읽기 전용 분석</span></div>
                <div style={{ padding: 16 }}>
                  <textarea value={projectPath} onChange={(event) => { setProjectPath(event.target.value); setFolderAccess(null); setVerifiedPathKey(""); }} placeholder={"프로젝트 폴더를 선택하거나 절대 경로를 입력하세요\n복수 저장소는 줄바꿈으로 구분할 수 있습니다"} rows={3} style={{ width: "100%", boxSizing: "border-box", resize: "vertical", minHeight: 82, padding: "12px 13px", borderRadius: 11, border: `1px solid ${t.divider}`, outline: 0, background: t.bg, color: t.text, fontFamily: "inherit", fontSize: 13, lineHeight: 1.5 }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><button onClick={() => setTestMode((value) => !value)} style={{ height: 30, borderRadius: 8, border: `1px solid ${testMode ? t.primary : t.divider}`, background: testMode ? t.primaryLight : "transparent", color: testMode ? t.primary : t.textSecondary, padding: "0 10px", fontSize: 11, cursor: "pointer" }}>빠른 테스트 {testMode ? "켜짐" : "꺼짐"}</button><button onClick={() => setBusinessFlowOnly((value) => !value)} style={{ height: 30, borderRadius: 8, border: `1px solid ${businessFlowOnly ? t.primary : t.divider}`, background: businessFlowOnly ? t.primaryLight : "transparent", color: businessFlowOnly ? t.primary : t.textSecondary, padding: "0 10px", fontSize: 11, cursor: "pointer" }}>비즈니스 플로우만 {businessFlowOnly ? "켜짐" : "꺼짐"}</button></div>
                    <div style={{ display: "flex", gap: 7 }}><button onClick={() => void handlePermissionCheck()} disabled={!projectPath.trim() || folderAccess?.status === "checking"} style={{ height: 32, borderRadius: 9, border: `1px solid ${t.primary}`, background: t.primaryLight, color: t.primary, padding: "0 12px", fontSize: 11, fontWeight: 650, cursor: !projectPath.trim() || folderAccess?.status === "checking" ? "not-allowed" : "pointer" }}>권한 확인</button><button onClick={handleBrowseFolder} disabled={isSelectingFolder} style={{ height: 32, borderRadius: 9, border: `1px solid ${t.divider}`, background: t.surface, color: t.text, padding: "0 12px", display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 650, cursor: isSelectingFolder ? "wait" : "pointer" }}>{isSelectingFolder ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />}{isSelectingFolder ? "여는 중" : "찾아보기"}</button></div>
                  </div>
                </div>
              </section>

              {folderAccess && <div style={{ marginLeft: 44, display: "flex", gap: 12, padding: "13px 15px", border: `1px solid ${folderAccess.status === "denied" ? "rgba(220,38,38,.28)" : t.divider}`, borderRadius: 13, background: folderAccess.status === "denied" ? "rgba(220,38,38,.05)" : t.surface }}><div style={{ width: 28, height: 28, borderRadius: 9, background: folderAccess.status === "denied" ? "rgba(220,38,38,.1)" : t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{folderAccess.status === "checking" ? <Loader2 size={14} className="animate-spin" color={t.primary} /> : folderAccess.status === "ready" ? <ShieldCheck size={14} color={t.primary} /> : <CircleAlert size={14} color="#dc2626" />}</div><div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 650 }}>{folderAccess.status === "checking" ? "macOS 권한 창에서 허용해 주세요" : folderAccess.status === "ready" ? "폴더 접근 준비 완료" : "폴더 접근이 필요합니다"}</div><div style={{ marginTop: 3, color: t.textMuted, fontSize: 11, lineHeight: 1.5 }}>{folderAccess.status === "ready" ? `${folderAccess.name} · ${folderAccess.summary || "전체 트리 확인 완료"}` : folderAccess.status === "denied" ? folderAccess.error || "macOS 설정에서 RepoLume의 파일 접근을 확인해 주세요." : "하위 폴더와 코드 파일을 실제 분석 프로세스로 확인하고 있습니다."}</div></div>{folderAccess.status === "denied" && <button onClick={() => void openPrivacySettings()} style={{ alignSelf: "center", border: `1px solid ${t.divider}`, borderRadius: 8, background: t.surface, color: t.textSecondary, padding: "6px 9px", fontSize: 10, cursor: "pointer" }}>시스템 설정 열기</button>}</div>}

              {cacheCheck?.status === "done" && cacheCheck.exists && <div style={{ marginLeft: 44, padding: 15, border: `1px solid ${cacheCheck.valid ? "rgba(22,163,74,.28)" : "rgba(217,119,6,.28)"}`, borderRadius: 13, background: cacheCheck.valid ? "rgba(22,163,74,.05)" : "rgba(217,119,6,.05)" }}><div style={{ fontSize: 12, fontWeight: 650, marginBottom: 10 }}>{cacheCheck.valid ? `완료된 위키 ${cacheCheck.page_count}페이지를 찾았습니다.` : `미완성 위키 ${cacheCheck.page_count}/${cacheCheck.total_pages}페이지를 찾았습니다.`}</div><div style={{ display: "flex", gap: 7 }}>{cacheCheck.valid ? <><button onClick={handleOpenExistingWiki} style={{ border: 0, borderRadius: 8, padding: "7px 10px", background: "rgba(22,163,74,.14)", color: "#16a34a", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>기존 위키 열기</button><button onClick={handleGenerateNew} style={{ border: `1px solid ${t.divider}`, borderRadius: 8, padding: "7px 10px", background: t.surface, color: t.textSecondary, fontSize: 11, cursor: "pointer" }}>새로 생성</button></> : <><button onClick={handleResumeFromCache} style={{ border: 0, borderRadius: 8, padding: "7px 10px", background: "rgba(217,119,6,.14)", color: "#d97706", fontSize: 11, fontWeight: 650, cursor: "pointer" }}>이어서 생성</button><button onClick={handleGenerateNew} style={{ border: `1px solid ${t.divider}`, borderRadius: 8, padding: "7px 10px", background: t.surface, color: t.textSecondary, fontSize: 11, cursor: "pointer" }}>처음부터</button></>}<button onClick={() => { setCacheCheck(null); setPendingPaths(null); }} style={{ border: 0, background: "transparent", color: t.textMuted, fontSize: 11, cursor: "pointer" }}>취소</button></div></div>}

              <div style={{ marginLeft: 44, display: "flex", justifyContent: "flex-end" }}><button onClick={cacheCheck?.status === "done" && cacheCheck.exists ? undefined : handleStartWithCacheCheck} disabled={!isAgyAuthed || !permissionReady || cacheCheck?.status === "checking" || Boolean(cacheCheck?.status === "done" && cacheCheck.exists)} style={{ minWidth: 154, height: 40, borderRadius: 11, border: 0, background: isAgyAuthed && permissionReady ? t.primary : t.divider, color: isAgyAuthed && permissionReady ? "#fff" : t.textMuted, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontSize: 12, fontWeight: 700, cursor: isAgyAuthed && permissionReady ? "pointer" : "not-allowed" }}>{cacheCheck?.status === "checking" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{cacheCheck?.status === "checking" ? "기존 작업 확인 중" : permissionReady ? "분석 계획 만들기" : "권한 확인 후 분석 가능"}</button></div>
              {!isAgyAuthed && <div style={{ marginLeft: 44, color: "#dc2626", fontSize: 11 }}>선택한 CLI 공급자의 인증을 설정에서 완료해 주세요.</div>}
            </div>
          </div>
        </main>

        <aside className="repolume-home-inspector" style={{ borderLeft: `1px solid ${t.divider}`, padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          <section><div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 10 }}>준비 상태</div><div style={{ display: "grid", gap: 8 }}>{[[appSettings?.setupComplete, "AI 모델 설정"], [permissionReady, "전체 트리 파일 권한"], [Boolean(projectPath.trim()), "분석 대상 선택"]].map(([ready, label]) => <div key={String(label)} style={{ display: "flex", alignItems: "center", gap: 8, color: ready ? t.text : t.textMuted, fontSize: 11 }}><CheckCircle2 size={14} color={ready ? "#16a34a" : t.textMuted} /><span>{String(label)}</span></div>)}</div></section>
          <section style={{ borderTop: `1px solid ${t.divider}`, paddingTop: 16 }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: t.textMuted, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 11 }}><ListTree size={13} /> 생성 계획</div><div style={{ display: "grid", gap: 9 }}>{["코드 및 저장소 구조 분석", "목차 제안 후 사용자 승인", "위키·다이어그램·API 문서 생성", "생성 결과 검토 및 내보내기"].map((label, index) => <div key={label} style={{ display: "flex", gap: 9, fontSize: 11, lineHeight: 1.45, color: t.textSecondary }}><span style={{ width: 20, height: 20, borderRadius: 7, background: t.surface, color: t.textMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>{index + 1}</span>{label}</div>)}</div></section>
          <section style={{ borderTop: `1px solid ${t.divider}`, paddingTop: 16 }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: t.textMuted, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", marginBottom: 10 }}><Shield size={13} /> macOS 권한</div><p style={{ margin: 0, color: t.textMuted, fontSize: 10, lineHeight: 1.6 }}>RepoLume는 시스템 권한을 자동 승인하지 않습니다. 표준 폴더 선택창에서 사용자가 선택한 위치만 분석하며 실행 직전 읽기 가능 여부를 다시 확인합니다.</p></section>
        </aside>
      </div>
    </div>
  );
}
