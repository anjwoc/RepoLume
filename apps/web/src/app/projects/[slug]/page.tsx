"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WikiViewer } from "@/components/wiki-viewer";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";
import { migrateLegacyBrowserStorage } from "@/lib/brand-migration";

const APP_SETTINGS_KEY = "repolume_app_settings";
const DARK_MODE_KEY = "repolume_is_dark";

interface RunMeta {
  owner: string;
  repo: string;
  language: string;
  model?: string;
}

function ProjectWikiContent() {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const [isDark, setIsDark] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    migrateLegacyBrowserStorage();
    setIsDark(localStorage.getItem(DARK_MODE_KEY) === "true");
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      try { setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) }); } catch {}
    }
  }, []);

  useEffect(() => {
    fetch(`/api/projects/${slug}`)
      .then((r) => {
        if (!r.ok) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        setRunMeta({
          owner: data.repo?.owner ?? "local",
          repo: data.repo?.repo ?? slug,
          language: data.language ?? "ko",
          model: data.model ?? undefined,
        });
      })
      .catch(() => setNotFound(true));
  }, [slug]);

  const toggleTheme = () => {
    setIsDark((d) => {
      localStorage.setItem(DARK_MODE_KEY, String(!d));
      return !d;
    });
  };

  if (notFound) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <p>위키를 찾을 수 없습니다: <code>{slug}</code></p>
      </div>
    );
  }

  if (!runMeta) {
    return <div style={{ width: "100%", height: "100vh" }} />;
  }

  const projectData = {
    owner: runMeta.owner,
    repo: runMeta.repo,
    repo_type: "local",
    language: runMeta.language,
    languages: [runMeta.language],
    model: runMeta.model,
  };

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#fff" }}
    >
      <WikiViewer
        isDark={isDark}
        onToggleTheme={toggleTheme}
        projectName={runMeta.repo}
        projectData={projectData}
        onGoHome={() => router.push("/")}
        repositoryBaseUrl={appSettings.repositoryBaseUrl}
        hoverBgColor={appSettings.hoverBgColor}
        initialPageId={searchParams.get("page") ?? undefined}
      />
    </div>
  );
}

export default function ProjectWikiPage() {
  return (
    <Suspense fallback={<div style={{ width: "100%", height: "100vh" }} />}>
      <ProjectWikiContent />
    </Suspense>
  );
}
