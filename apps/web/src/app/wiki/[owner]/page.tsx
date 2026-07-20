"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { WikiViewer } from "@/components/wiki-viewer";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";
import { migrateLegacyBrowserStorage } from "@/lib/brand-migration";

const APP_SETTINGS_KEY = "repolume_app_settings";
const DARK_MODE_KEY = "repolume_is_dark";

interface ProjectData {
  owner: string;
  repo: string;
  repo_type: string;
  language: string;
  languages?: string[];
  model?: string;
  slug?: string;
}

function WikiSlugContent() {
  const router = useRouter();
  const { owner: slug } = useParams<{ owner: string }>();
  const searchParams = useSearchParams();
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    migrateLegacyBrowserStorage();
    setIsDark(localStorage.getItem(DARK_MODE_KEY) === "true");
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      try { setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) }); } catch {}
    }

    fetch(`/api/wiki/project/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setProjectData({ ...data, languages: [data.language] }))
      .catch(() => setError(`프로젝트 '${slug}'를 찾을 수 없습니다.`));
  }, [slug]);

  const toggleTheme = () => {
    setIsDark(d => {
      localStorage.setItem(DARK_MODE_KEY, String(!d));
      return !d;
    });
  };

  if (error) {
    return (
      <div style={{ padding: 40, color: "#f87171", fontFamily: "monospace" }}>
        {error}
      </div>
    );
  }

  if (!projectData) {
    return <div style={{ width: "100%", height: "100vh" }} />;
  }

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#fff" }}
    >
      <WikiViewer
        isDark={isDark}
        onToggleTheme={toggleTheme}
        projectName={projectData.repo}
        projectData={projectData}
        onGoHome={() => router.push("/")}
        repositoryBaseUrl={appSettings.repositoryBaseUrl}
        hoverBgColor={appSettings.hoverBgColor}
        initialPageId={searchParams.get("page") || undefined}
      />
    </div>
  );
}

export default function WikiSlugPage() {
  return (
    <Suspense fallback={<div style={{ width: "100%", height: "100vh" }} />}>
      <WikiSlugContent />
    </Suspense>
  );
}
