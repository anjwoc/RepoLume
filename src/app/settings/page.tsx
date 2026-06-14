"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SettingsScreen } from "@/components/settings-screen";
import { AppSettings, DEFAULT_APP_SETTINGS } from "@/components/setup-wizard";
import { MCPSettings, DEFAULT_MCP_SETTINGS } from "@/lib/mcp-types";

const APP_SETTINGS_KEY = "localwiki_app_settings";
const DARK_MODE_KEY = "localwiki_is_dark";

function mergeMcpSettings(saved: MCPSettings): MCPSettings {
  const savedIds = new Set(saved.providers.map((p) => p.id));
  const newProviders = DEFAULT_MCP_SETTINGS.providers.filter((p) => !savedIds.has(p.id));
  return { ...DEFAULT_MCP_SETTINGS, ...saved, providers: [...saved.providers, ...newProviders] };
}

export default function SettingsPage() {
  const router = useRouter();
  const [isDark, setIsDark] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [mcpSettings, setMcpSettings] = useState<MCPSettings>(DEFAULT_MCP_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const dark = localStorage.getItem(DARK_MODE_KEY) === "true";
    setIsDark(dark);

    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      try {
        setAppSettings({ ...DEFAULT_APP_SETTINGS, ...JSON.parse(raw) });
      } catch {}
    }

    fetch("/api/settings/mcp_settings")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.found && data.value) {
          setMcpSettings(mergeMcpSettings(data.value as MCPSettings));
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSaveAppSettings = (updates: any) => {
    const next = { ...appSettings, ...updates };
    setAppSettings(next);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
  };

  if (!loaded) {
    return (
      <div style={{ width: "100%", height: "100vh", background: isDark ? "#121212" : "#fff" }} />
    );
  }

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#fff" }}
    >
      <SettingsScreen
        isDark={isDark}
        onBack={() => router.push("/")}
        settings={mcpSettings}
        onSaveSettings={(s) => {
          setMcpSettings(s);
          fetch("/api/settings/mcp_settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: s }),
          }).catch(() => {});
        }}
        appSettings={appSettings}
        onSaveAppSettings={handleSaveAppSettings}
      />
    </div>
  );
}
