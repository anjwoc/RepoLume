"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WikiViewer } from "@/components/wiki-viewer";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";

const APP_SETTINGS_KEY = "localwiki_app_settings";
const DARK_MODE_KEY = "localwiki_is_dark";

interface ProjectData {
  owner: string;
  repo: string;
  repo_type: string;
  language: string;
  languages?: string[];
  model?: string;
  id?: string;
}

function WikiContent() {
  const router = useRouter();
  const { owner, repo } = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();
  const [isDark, setIsDark] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  useEffect(() => {
    setIsDark(localStorage.getItem(DARK_MODE_KEY) === "true");
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      try {
        setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) });
      } catch {}
    }
  }, []);

  const toggleTheme = () => {
    setIsDark((d) => {
      localStorage.setItem(DARK_MODE_KEY, String(!d));
      return !d;
    });
  };

  const projectData: ProjectData = {
    owner,
    repo,
    repo_type: searchParams.get("repo_type") || "local",
    language: searchParams.get("language") || "ko",
    languages: searchParams.get("languages")?.split(",").filter(Boolean) || ["ko"],
    model: searchParams.get("model") || undefined,
    id: searchParams.get("id") || undefined,
  };

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#fff" }}
    >
      <WikiViewer
        isDark={isDark}
        onToggleTheme={toggleTheme}
        projectName={repo}
        projectData={projectData}
        onGoHome={() => router.push("/")}
        repositoryBaseUrl={appSettings.repositoryBaseUrl}
        hoverBgColor={appSettings.hoverBgColor}
      />
    </div>
  );
}

export default function WikiPage() {
  return (
    <Suspense fallback={<div style={{ width: "100%", height: "100vh" }} />}>
      <WikiContent />
    </Suspense>
  );
}
