"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { HomeScreen } from "@/components/home-screen";
import { SetupWizard, AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";

const APP_SETTINGS_KEY = "localwiki_app_settings";
const DARK_MODE_KEY = "localwiki_is_dark";

function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;
  let settings = DEFAULT_APP_SETTINGS;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) settings = { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  if (process.env.NEXT_PUBLIC_SHOWCASE_MODE === "true") {
    settings.setupComplete = true;
  }
  return settings;
}

function sanitizeRepoName(path: string) {
  const raw = path.replace(/\/+$/, "").split("/").pop() || "project";
  return raw
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "") || "project";
}

export default function Page() {
  const router = useRouter();
  const [showSetup, setShowSetup] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    const saved = loadAppSettings();
    setAppSettings(saved);
    setIsDark(localStorage.getItem(DARK_MODE_KEY) === "true");
    if (!saved.setupComplete) setShowSetup(true);
  }, []);

  const handleSetupComplete = (settings: AppSettings) => {
    setAppSettings(settings);
    setShowSetup(false);
  };

  const handleSaveAppSettings = (updates: Partial<AppSettings>) => {
    const next = { ...appSettings, ...updates };
    setAppSettings(next);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  };

  const handleSelectProject = (path: string, testMode: boolean, enableBusiness: boolean, paths?: string[]) => {
    const analysisPaths = paths && paths.length > 0 ? paths : [path];
    const primaryPath = analysisPaths[0] || path;
    const repo = sanitizeRepoName(primaryPath);
    // Store path for resume (same machine, same user)
    try { localStorage.setItem(`localwiki_path_${repo}`, primaryPath); } catch {}

    const p = new URLSearchParams({
      path: primaryPath,
      paths: analysisPaths.join(","),
      testMode: String(testMode),
      enableBusiness: String(enableBusiness),
      provider: appSettings.provider,
      model: appSettings.model || "",
      mode: appSettings.mode || "cli",
      cliTool:
        appSettings.provider === "google" ? "gemini"
        : appSettings.provider === "anthropic" ? "claude"
        : appSettings.provider === "antigravity" ? "antigravity"
        : "codex",
      apiKey: appSettings.apiKey || "",
      language: appSettings.language,
      languages: (appSettings.languages || [appSettings.language]).join(","),
      owner: "local",
      repo,
      repo_type: "local",
      pageConcurrency: String((appSettings as any).pageConcurrency ?? 3),
    });
    router.push(`/analyzing?${p.toString()}`);
  };

  const handleResumeProject = async (owner: string, repo: string, repo_type: string, language: string, parentJobId: string) => {
    const storedPath = localStorage.getItem(`localwiki_path_${repo}`);
    if (!storedPath) {
      alert('저장된 프로젝트 경로를 찾을 수 없습니다. 홈 화면에서 경로를 입력해 이어서 생성해 주세요.');
      return;
    }
    try {
      const res = await fetch('/api/wiki/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, repo, repo_type, language, model: appSettings.model || '', parent_job_id: parentJobId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      sessionStorage.setItem('localwiki_resume_pending', JSON.stringify({
        streamId: data.stream_id,
        completedPageIds: data.completed_page_ids ?? [],
        wikiStructure: data.wiki_structure,
        generatedPages: data.generated_pages ?? {},
      }));
      const p = new URLSearchParams({
        path: storedPath, owner, repo, repo_type, language,
        isResume: 'true',
        provider: appSettings.provider,
        model: appSettings.model || '',
        mode: appSettings.mode || 'cli',
        cliTool: appSettings.provider === 'google' ? 'gemini'
          : appSettings.provider === 'anthropic' ? 'claude'
          : appSettings.provider === 'antigravity' ? 'antigravity' : 'codex',
        apiKey: appSettings.apiKey || '',
        enableBusiness: 'false',
        pageConcurrency: String((appSettings as any).pageConcurrency ?? 3),
      });
      router.push(`/analyzing?${p.toString()}`);
    } catch (err) {
      console.error('Resume failed', err);
      alert('이어서 생성 준비 중 오류가 발생했습니다.');
    }
  };

  const handleOpenWiki = (
    owner: string,
    repo: string,
    repo_type: string,
    language: string,
    languages?: string[],
    model?: string,
    id?: string,
  ) => {
    const p = new URLSearchParams({ repo_type, language, languages: (languages || [language]).join(",") });
    if (model) p.set("model", model);
    if (id) p.set("id", id);
    router.push(`/wiki/${owner}/${repo}?${p.toString()}`);
  };

  const toggleTheme = () => {
    setIsDark((d) => {
      localStorage.setItem(DARK_MODE_KEY, String(!d));
      return !d;
    });
  };

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#FFFFFF" }}
    >
      <AnimatePresence mode="wait">
        {showSetup ? (
          <SetupWizard
            key="setup"
            isDark={isDark}
            onComplete={handleSetupComplete}
          />
        ) : (
          <HomeScreen
            key="home"
            isDark={isDark}
            onToggleTheme={toggleTheme}
            onSelectProject={handleSelectProject}
            onOpenWiki={handleOpenWiki}
            onResumeProject={handleResumeProject}
            onOpenSettings={() => router.push("/settings")}
            onOpenAdmin={() => router.push("/admin")}
            appSettings={appSettings}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
