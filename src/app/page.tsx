"use client";

import { useState, useEffect } from "react";
import { AnimatePresence } from "motion/react";
import { HomeScreen } from "@/components/home-screen";
import { StreamLogViewer } from "@/components/stream-log-viewer";
import { WikiViewer } from "@/components/wiki-viewer";
import { SettingsScreen } from "@/components/settings-screen";
import { SetupWizard, AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";
import { MCPSettings, DEFAULT_MCP_SETTINGS } from "@/lib/mcp-types";
import { AdminLogsScreen } from "@/components/admin-logs";

type Screen = "setup" | "home" | "analyzing" | "wiki" | "settings" | "admin";

interface ProjectData {
  owner: string;
  repo: string;
  repo_type: string;
  language: string;
  languages?: string[];
  model?: string;
}

const APP_SETTINGS_KEY = "localwiki_app_settings";

function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_APP_SETTINGS;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_APP_SETTINGS;
}

export default function Page() {
  const [screen, setScreen] = useState<Screen>("home");
  const [isDark, setIsDark] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [mcpSettings, setMcpSettings] = useState<MCPSettings>(DEFAULT_MCP_SETTINGS);
  const [testMode, setTestMode] = useState<boolean>(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  // On mount, load saved settings and determine initial screen
  useEffect(() => {
    const saved = loadAppSettings();
    setAppSettings(saved);
    if (!saved.setupComplete) {
      setScreen("setup");
      return;
    }
    
    // Check URL for deep linking
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlScreen = params.get("screen");
      if (urlScreen === "wiki") {
        const repo = params.get("repo");
        if (repo) {
          setProjectData({
            owner: params.get("owner") || "local",
            repo: repo,
            repo_type: params.get("repo_type") || "local",
            language: params.get("language") || "ko",
            languages: params.get("languages")?.split(",") || [params.get("language") || "ko"],
            model: params.get("model") || undefined,
          });
          setScreen("wiki");
          return;
        }
      }
    }
  }, []);

  // Sync state to URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (screen === "wiki" && projectData) {
      url.searchParams.set("screen", "wiki");
      url.searchParams.set("owner", projectData.owner);
      url.searchParams.set("repo", projectData.repo);
      url.searchParams.set("repo_type", projectData.repo_type);
      url.searchParams.set("language", projectData.language);
      if (projectData.languages) {
        url.searchParams.set("languages", projectData.languages.join(","));
      }
      if (projectData.model) {
        url.searchParams.set("model", projectData.model);
      }
    } else {
      url.search = "";
    }
    window.history.replaceState({}, "", url.toString());
  }, [screen, projectData]);

  const handleSetupComplete = (settings: AppSettings) => {
    setAppSettings(settings);
    setScreen("home");
  };

  const handleSaveAppSettings = (updates: Partial<AppSettings>) => {
    const next = { ...appSettings, ...updates };
    setAppSettings(next);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  };

  const sanitizeRepoName = (path: string) => {
    const raw = path.replace(/\/+$/, "").split("/").pop() || "project";
    return raw
      .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.\-]+|[_.\-]+$/g, "")
      || "project";
  };

  const handleSelectProject = (path: string, testMode: boolean) => {
    setProjectPath(path);
    setTestMode(testMode);
    setProjectData({
      owner: "local",
      repo: sanitizeRepoName(path),
      repo_type: "local",
      language: (appSettings.languages || [appSettings.language])[0] || "ko",
      languages: appSettings.languages || [appSettings.language],
      model: appSettings.model,
    });
    setScreen("analyzing");
  };

  const handleOpenWiki = (owner: string, repo: string, repo_type: string, language: string, languages?: string[], model?: string) => {
    setProjectData({ owner, repo, repo_type, language, languages: languages || [language], model });
    setScreen("wiki");
  };

  const toggleTheme = () => setIsDark((d) => !d);
  const projectName = projectData ? projectData.repo : sanitizeRepoName(projectPath);

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        background: isDark ? "#121212" : "#FFFFFF",
      }}
    >
      <AnimatePresence mode="wait">
        {screen === "setup" && (
          <SetupWizard
            key="setup"
            isDark={isDark}
            onComplete={handleSetupComplete}
          />
        )}
        {screen === "home" && (
          <HomeScreen
            key="home"
            isDark={isDark}
            onToggleTheme={toggleTheme}
            onSelectProject={handleSelectProject}
            onOpenWiki={handleOpenWiki}
            onOpenSettings={() => setScreen("settings")}
            onOpenAdmin={() => setScreen("admin")}
            appSettings={appSettings}
          />
        )}
        {screen === "analyzing" && (
          <StreamLogViewer
            key="analyzing"
            isDark={isDark}
            projectPath={projectPath}
            language={appSettings.language}
            languages={appSettings.languages || [appSettings.language]}
            testMode={testMode}
            provider={appSettings.provider}
            model={appSettings.model}
            mode={appSettings.mode as "cli" | "api"}
            cliTool={appSettings.provider === "google" ? "gemini" : appSettings.provider === "anthropic" ? "claude" : appSettings.provider === "antigravity" ? "antigravity" : "codex"}
            apiKey={appSettings.apiKey || ""}
            onComplete={() => setScreen("wiki")}
            onCancel={() => setScreen("home")}
          />
        )}
        {screen === "wiki" && (
          <WikiViewer
            key="wiki"
            isDark={isDark}
            onToggleTheme={toggleTheme}
            projectName={projectName}
            projectData={projectData}
            onGoHome={() => setScreen("home")}
          />
        )}
        {screen === "settings" && (
          <SettingsScreen
            key="settings"
            isDark={isDark}
            onBack={() => setScreen("home")}
            settings={mcpSettings}
            onSaveSettings={setMcpSettings}
            appSettings={appSettings}
            onSaveAppSettings={(updates) => {
              handleSaveAppSettings(updates as Partial<AppSettings>);
            }}
          />
        )}
        {screen === "admin" && (
          <AdminLogsScreen
            key="admin"
            isDark={isDark}
            onBack={() => setScreen("home")}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
