"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings, ArrowLeft, Database,
  FolderKanban, Check, X, Eye, EyeOff, RefreshCw,
  ChevronRight, Zap, Shield, Clock, ExternalLink,
  Plus, Trash2, Terminal, AlertCircle
} from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { getTheme } from "@/lib/theme";
import {
  MCPProvider, MCPSettings, MCPConfig,
  DEFAULT_MCP_SETTINGS, MCP_CATEGORIES
} from "@/lib/mcp-types";

interface SettingsScreenProps {
  isDark: boolean;
  onBack: () => void;
  settings: MCPSettings;
  onSaveSettings: (settings: MCPSettings) => void;
  appSettings: { language: string; languages?: string[]; provider: string; model: string; mode?: string; apiKey?: string; repositoryBaseUrl?: string; hoverBgColor?: string };
  onSaveAppSettings: (settings: Partial<{ language: string; languages: string[]; provider: string; model: string; mode: string; apiKey: string; setupComplete: boolean; repositoryBaseUrl: string; hoverBgColor: string }>) => void;
}

// MCP 아이콘 컴포넌트
function MCPIcon({ type, size = 20 }: { type: string; size?: number }) {
  switch (type) {
    case "github":
      return <FaGithub size={size} />;
    case "database":
      return <Database size={size} />;
    case "jira":
    case "confluence":
      return <FolderKanban size={size} />;
    default:
      return <Database size={size} />;
  }
}

export function SettingsScreen({
  isDark,
  onBack,
  settings: initialSettings,
  onSaveSettings,
  appSettings: initialAppSettings,
  onSaveAppSettings,
}: SettingsScreenProps) {
  const t = getTheme(isDark);
  const [settings, setSettings] = useState<MCPSettings>(initialSettings);
  const [appSettings, setAppSettings] = useState({
    language: initialAppSettings.language || "ko",
    languages: initialAppSettings.languages || [initialAppSettings.language || "ko"],
    provider: initialAppSettings.provider || "openai",
    model: initialAppSettings.model || "gpt-5.5",
    mode: (initialAppSettings.mode as "cli" | "api") || "cli",
    apiKey: initialAppSettings.apiKey || "",
    repositoryBaseUrl: initialAppSettings.repositoryBaseUrl || "",
    hoverBgColor: initialAppSettings.hoverBgColor || "rgba(60,130,246,0.06)",
    pageConcurrency: (initialAppSettings as any).pageConcurrency ?? 3,
  });
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [customProviders, setCustomProviders] = useState<MCPProvider[]>([]);
  const [localSources, setLocalSources] = useState<Record<string, string[]>>({});

  // Load custom (internal) MCP providers from backend config on mount
  useEffect(() => {
    fetch("/api/mcp/custom-providers")
      .then((r) => r.ok ? r.json() : [])
      .then((data: MCPProvider[]) => setCustomProviders(data))
      .catch(() => {});
  }, []);

  // Auto-populate provider configs from local AI tool configs on mount
  useEffect(() => {
    fetch("/api/mcp/local-config")
      .then((r) => r.ok ? r.json() : { providers: {}, sources: {} })
      .then((data: { providers: Record<string, Record<string, string>>; sources: Record<string, string[]> }) => {
        if (!data.providers || Object.keys(data.providers).length === 0) return;
        if (data.sources) setLocalSources(data.sources);
        setSettings((prev) => ({
          ...prev,
          providers: prev.providers.map((p) => {
            const local = data.providers[p.id];
            if (!local) return p;
            const merged: typeof p.config = { ...p.config };
            for (const [k, v] of Object.entries(local)) {
              if (v && !merged[k as keyof typeof merged]) {
                (merged as Record<string, string>)[k] = v;
              }
            }
            return { ...p, config: merged };
          }),
        }));
      })
      .catch(() => {});
  }, []);

  // Antigravity CLI Auth States
  const [agyAuthStatus, setAgyAuthStatus] = useState<"idle" | "checking" | "needs_auth" | "authenticating" | "success" | "error">("idle");
  const [agyAuthUrl, setAgyAuthUrl] = useState("");
  const [agyAuthCode, setAgyAuthCode] = useState("");
  const [agyAuthError, setAgyAuthError] = useState("");

  useEffect(() => {
    if (appSettings.provider === "antigravity" && appSettings.mode === "cli") {
      checkAgyAuthStatus();
    } else {
      setAgyAuthStatus("idle");
    }
  }, [appSettings.provider, appSettings.mode]);

  const checkAgyAuthStatus = async () => {
    setAgyAuthStatus("checking");
    try {
      const res = await fetch("http://localhost:8001/agent/auth/status");
      const data = await res.json();
      if (data.authenticated) {
        setAgyAuthStatus("success");
      } else {
        setAgyAuthStatus("needs_auth");
      }
    } catch (e) {
      console.error(e);
      setAgyAuthStatus("needs_auth");
    }
  };

  const startAgyAuth = async () => {
    setAgyAuthStatus("authenticating");
    setAgyAuthError("");
    try {
      const res = await fetch("http://localhost:8001/agent/auth/start", { method: "POST" });
      const data = await res.json();
      if (data.success && data.url) {
        setAgyAuthUrl(data.url);
        window.open(data.url, "_blank");
      } else {
        setAgyAuthStatus("error");
        setAgyAuthError(data.error || "인증 시작 실패");
      }
    } catch (e) {
      setAgyAuthStatus("error");
      setAgyAuthError(String(e));
    }
  };

  const submitAgyAuthCode = async () => {
    if (!agyAuthCode.trim()) return;
    try {
      const res = await fetch("http://localhost:8001/agent/auth/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: agyAuthCode })
      });
      const data = await res.json();
      if (data.success) {
        setAgyAuthStatus("success");
      } else {
        setAgyAuthError(data.detail || data.error || "인증 실패. 코드를 다시 확인해주세요.");
      }
    } catch (e) {
      setAgyAuthError(String(e));
    }
  };

  const updateSettings = (updates: Partial<MCPSettings>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setHasChanges(true);
  };

  const updateProvider = (providerId: string, updates: Partial<MCPProvider>) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) =>
        p.id === providerId ? { ...p, ...updates } : p
      ),
    }));
    setHasChanges(true);
  };

  const updateProviderConfig = (providerId: string, config: Partial<MCPConfig>) => {
    setSettings((prev) => ({
      ...prev,
      providers: prev.providers.map((p) =>
        p.id === providerId ? { ...p, config: { ...p.config, ...config } } : p
      ),
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    onSaveSettings(settings);
    onSaveAppSettings(appSettings);
    setHasChanges(false);
  };

  const handleTestConnection = async (provider: MCPProvider) => {
    setTestingProvider(provider.id);
    setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, message: "" } }));
    try {
      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider_type: provider.type, config: provider.config }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [provider.id]: { ok: data.ok, message: data.message } }));
      if (data.ok) {
        updateProvider(provider.id, { isConnected: true });
      }
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: { ok: false, message: `연결 테스트 실패: ${String(e)}` },
      }));
    } finally {
      setTestingProvider(null);
    }
  };




  const toggleTokenVisibility = (providerId: string) => {
    setShowTokens((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const groupByCategory = (providers: MCPProvider[]) =>
    providers.reduce((acc, provider) => {
      const category = provider.category;
      if (!acc[category]) acc[category] = [];
      acc[category].push(provider);
      return acc;
    }, {} as Record<string, MCPProvider[]>);

  const groupedOfficial = groupByCategory(
    settings.providers.filter((p) => p.edition === "official")
  );
  const groupedCommunity = groupByCategory(
    settings.providers.filter((p) => p.edition === "community")
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      style={{
        width: "100%",
        height: "100vh",
        background: t.bg,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 24px",
          borderBottom: `1px solid ${t.divider}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "none",
              background: t.surface,
              color: t.textSecondary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = t.surfaceHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = t.surface;
            }}
          >
            <ArrowLeft size={18} />
          </button>
          <div
            style={{
              width: 40,
              height: 40,
              background: `linear-gradient(145deg, ${t.primary}, #1A5FD4)`,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Settings size={20} color="white" />
          </div>
          <div>
            <h1 style={{ color: t.text, fontSize: 16, fontWeight: 600, margin: 0 }}>
              설정
            </h1>
            <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}>
              MCP 데이터 소스 및 엔진 설정
            </p>
          </div>
        </div>

        <AnimatePresence>
          {hasChanges && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              onClick={handleSave}
              style={{
                padding: "10px 20px",
                background: t.primary,
                border: "none",
                borderRadius: 10,
                color: "white",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "inherit",
              }}
            >
              <Check size={16} />
              저장
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* 기본 설정 */}
          <section style={{ marginBottom: 32 }}>
            <h2
              style={{
                color: t.text,
                fontSize: 14,
                fontWeight: 600,
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Settings size={16} color={t.primary} />
              기본 설정
            </h2>
            <div
              style={{
                background: t.surface,
                borderRadius: 16,
                padding: "20px",
              }}
            >
              {/* Language Selector — 멀티셀렉트 체크박스 */}
              {/* Model Selector */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>
                    AI 모델 선택
                  </p>
                  <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>
                    문서 생성에 사용할 AI 모델을 선택합니다
                  </p>
                </div>
                <select
                  value={appSettings.model}
                  onChange={(e) => {
                    const model = e.target.value;
                    let provider = "openai";
                    if (model.startsWith("gemini")) provider = "google";
                    else if (model.startsWith("claude")) provider = "anthropic";
                    else if (model.startsWith("agy")) provider = "antigravity";
                    setAppSettings(prev => ({ ...prev, model, provider }));
                    setHasChanges(true);
                  }}
                  style={{
                    background: isDark ? "rgba(0,0,0,0.4)" : "#fff",
                    color: t.text,
                    border: `1px solid ${t.divider}`,
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: 13,
                    outline: 'none',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  <optgroup label="Codex (ChatGPT)">
                    <option value="gpt-5.5-mini">gpt-5.5-mini (빠름, 기본)</option>
                    <option value="gpt-5.5">gpt-5.5 (고성능)</option>
                  </optgroup>
                  <optgroup label="Gemini">
                    <option value="gemini-2.5-flash">gemini-2.5-flash (빠름, 기본)</option>
                    <option value="gemini-2.5-pro">gemini-2.5-pro (고성능)</option>
                  </optgroup>
                  <optgroup label="Claude">
                    <option value="claude-haiku-3-5">claude-haiku-3-5 (빠름, 기본)</option>
                    <option value="claude-sonnet-4-5">claude-sonnet-4-5 (고성능)</option>
                  </optgroup>
                  <optgroup label="Antigravity CLI">
                    <option value="agy-gemini-3.5-flash-medium">Gemini 3.5 Flash (Medium)</option>
                    <option value="agy-gemini-3.5-flash-high">Gemini 3.5 Flash (High)</option>
                    <option value="agy-gemini-3.5-flash-low">Gemini 3.5 Flash (Low)</option>
                    <option value="agy-gemini-3.1-pro-low">Gemini 3.1 Pro (Low)</option>
                    <option value="agy-gemini-3.1-pro-high">Gemini 3.1 Pro (High)</option>
                    <option value="agy-claude-sonnet-4.6-thinking">Claude Sonnet 4.6 (Thinking) ⚠️</option>
                    <option value="agy-claude-opus-4.6-thinking">Claude Opus 4.6 (Thinking) ⚠️</option>
                    <option value="agy-gpt-oss-120b-medium">GPT-OSS 120B (Medium) ⚠️</option>
                  </optgroup>
                </select>
              </div>

              {/* 실행 모드 */}
              <div style={{ paddingTop: 16, borderTop: `1px solid ${t.divider}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>실행 모드</p>
                    <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>AI 연결 방식을 선택합니다</p>
                  </div>
                  <div style={{ display: "flex", gap: 6, background: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.03)", padding: 4, borderRadius: 8 }}>
                    {[
                      { id: "cli", label: "🖥️ CLI" },
                      { id: "api", label: "🌐 API" },
                    ].map((m) => (
                      <button key={m.id} onClick={() => { setAppSettings(prev => ({ ...prev, mode: m.id as "cli" | "api" })); setHasChanges(true); }} style={{
                        background: appSettings.mode === m.id ? t.primary : "transparent",
                        color: appSettings.mode === m.id ? "#fff" : t.textSecondary,
                        padding: "6px 14px", borderRadius: 6, fontSize: 13,
                        fontWeight: appSettings.mode === m.id ? 600 : 500,
                        border: "none", cursor: "pointer", transition: "all 0.2s",
                      }}>{m.label}</button>
                    ))}
                  </div>
                </div>
                {appSettings.mode === "cli" && (
                  <div style={{ padding: "10px 14px", borderRadius: 10, background: t.primaryLight, border: `1px solid ${t.primaryBorder}` }}>
                    <p style={{ color: t.primary, fontSize: 12, margin: 0, fontWeight: 500 }}>✅ 서버 환경변수의 API 키를 자동으로 사용합니다</p>
                  </div>
                )}
                {appSettings.mode === "api" && (
                  <div>
                    <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>API Key</label>
                    <input
                      type="password"
                      value={appSettings.apiKey}
                      onChange={(e) => { setAppSettings(prev => ({ ...prev, apiKey: e.target.value })); setHasChanges(true); }}
                      placeholder="sk-...  /  AIza...  /  sk-ant-..."
                      style={{
                        width: "100%", padding: "9px 12px", borderRadius: 8,
                        border: `1.5px solid ${t.divider}`, background: t.bg, color: t.text,
                        fontSize: 13, outline: "none", boxSizing: "border-box" as const,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Repository Base URL */}
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${t.divider}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>Repository Web URL</p>
                    <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>사내망 Github 등 커스텀 링크 생성에 사용됩니다</p>
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={appSettings.repositoryBaseUrl}
                    onChange={(e) => { setAppSettings(prev => ({ ...prev, repositoryBaseUrl: e.target.value })); setHasChanges(true); }}
                    placeholder="https://github.company.com/org"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      border: `1.5px solid ${t.divider}`, background: t.bg, color: t.text,
                      fontSize: 13, outline: "none", boxSizing: "border-box" as const,
                    }}
                  />
                </div>
              </div>

              <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${t.divider}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div>
                    <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>호버 배경 색상</p>
                    <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>문서 단락 호버 시 표시되는 배경 색상을 지정합니다.</p>
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={appSettings.hoverBgColor}
                    onChange={(e) => { setAppSettings(prev => ({ ...prev, hoverBgColor: e.target.value })); setHasChanges(true); }}
                    placeholder="예: rgba(60,130,246,0.06) 또는 #f0fdf4"
                    style={{
                      width: "100%", padding: "9px 12px", borderRadius: 8,
                      border: `1.5px solid ${t.divider}`, background: t.bg, color: t.text,
                      fontSize: 13, outline: "none", boxSizing: "border-box" as const,
                    }}
                  />
                </div>
              </div>

              {/* Page concurrency */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 16, paddingTop: 12, borderTop: `1px solid ${t.divider}` }}>
                <div>
                  <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>페이지 동시 생성 수</p>
                  <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>
                    한 번에 병렬로 생성할 페이지 수입니다. 높을수록 빠르지만 API 레이트 리밋에 걸릴 수 있습니다.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={appSettings.pageConcurrency}
                    onChange={(e) => { setAppSettings(prev => ({ ...prev, pageConcurrency: Number(e.target.value) })); setHasChanges(true); }}
                    style={{ width: 100, accentColor: t.primary }}
                  />
                  <span style={{
                    minWidth: 28, textAlign: "center", fontSize: 14, fontWeight: 700,
                    color: t.primary, fontVariantNumeric: "tabular-nums",
                  }}>
                    {appSettings.pageConcurrency}
                  </span>
                </div>
              </div>

              {/* Antigravity CLI Auth UI */}
              {appSettings.provider === "antigravity" && appSettings.mode === "cli" && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${t.divider}` }}>
                  <p style={{ color: t.text, fontSize: 13, fontWeight: 700, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                    <Terminal size={14} /> Antigravity CLI 인증
                  </p>

                  {agyAuthStatus === "checking" && <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}><RefreshCw size={12} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} /> 인증 상태 확인 중...</p>}

                  {agyAuthStatus === "success" && <p style={{ color: t.success || "#10b981", fontSize: 13, margin: 0, fontWeight: 600 }}>✅ 인증이 완료되어 바로 사용할 수 있습니다.</p>}

                  {(agyAuthStatus === "needs_auth" || agyAuthStatus === "error") && (
                    <div>
                      <p style={{ color: t.textSecondary, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>
                        Antigravity CLI를 사용하려면 Google 계정 로그인이 필요합니다.
                      </p>
                      <button onClick={startAgyAuth} style={{
                        padding: "8px 14px", borderRadius: 8, border: `1px solid ${t.primary}`, background: "transparent",
                        color: t.primary, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6
                      }}>
                        <ExternalLink size={14} /> 브라우저에서 로그인하기
                      </button>
                      {agyAuthError && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={12} /> {agyAuthError}</p>}
                    </div>
                  )}

                  {agyAuthStatus === "authenticating" && (
                    <div style={{ marginTop: 4 }}>
                      <p style={{ color: t.textSecondary, fontSize: 12, margin: "0 0 8px" }}>
                        열린 브라우저에서 로그인 후 발급된 <b>권한 부여 코드</b>를 아래에 붙여넣어주세요.
                      </p>
                      {agyAuthUrl && (
                        <p style={{ fontSize: 11, color: t.textMuted, margin: "0 0 8px", wordBreak: "break-all" }}>
                          (창이 열리지 않았다면 <a href={agyAuthUrl} target="_blank" rel="noreferrer" style={{ color: t.primary }}>여기</a>를 클릭)
                        </p>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="text"
                          value={agyAuthCode}
                          onChange={(e) => setAgyAuthCode(e.target.value)}
                          placeholder="4/0AeoWu..."
                          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.divider}`, background: t.surface, color: t.text, fontSize: 12 }}
                        />
                        <button onClick={submitAgyAuthCode} style={{
                          padding: "8px 16px", borderRadius: 8, border: "none", background: t.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer"
                        }}>제출</button>
                      </div>
                      {agyAuthError && <p style={{ color: "#ef4444", fontSize: 12, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}><AlertCircle size={12} /> {agyAuthError}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Cross-Check 설정 */}
          <section style={{ marginBottom: 32 }}>
            <h2
              style={{
                color: t.text,
                fontSize: 14,
                fontWeight: 600,
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Shield size={16} color={t.primary} />
              크로스체크 설정
            </h2>
            <div
              style={{
                background: t.surface,
                borderRadius: 16,
                padding: "20px",
              }}
            >
              {/* Cross-Check 활성화 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 20,
                }}
              >
                <div>
                  <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>
                    MCP 크로스체크 활성화
                  </p>
                  <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>
                    여러 데이터 소스의 정보를 교차 검증하여 문서 정확도를 높입니다
                  </p>
                </div>
                <ToggleSwitch
                  checked={settings.crossCheckEnabled}
                  onChange={(checked) => updateSettings({ crossCheckEnabled: checked })}
                  theme={t}
                />
              </div>

              {/* Auto Sync */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 20,
                  paddingTop: 16,
                  borderTop: `1px solid ${t.divider}`,
                }}
              >
                <div>
                  <p style={{ color: t.text, fontSize: 14, fontWeight: 500, margin: 0 }}>
                    자동 동기화
                  </p>
                  <p style={{ color: t.textSecondary, fontSize: 12, margin: "4px 0 0 0" }}>
                    주기적으로 연결된 데이터 소스와 자동 동기화합니다
                  </p>
                </div>
                <ToggleSwitch
                  checked={settings.autoSync}
                  onChange={(checked) => updateSettings({ autoSync: checked })}
                  theme={t}
                />
              </div>

              {/* Sync Interval */}
              <AnimatePresence>
                {settings.autoSync && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingTop: 16,
                      borderTop: `1px solid ${t.divider}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Clock size={14} color={t.textMuted} />
                      <p style={{ color: t.text, fontSize: 13, margin: 0 }}>
                        동기화 간격
                      </p>
                    </div>
                    <select
                      value={settings.syncInterval}
                      onChange={(e) =>
                        updateSettings({ syncInterval: parseInt(e.target.value) })
                      }
                      style={{
                        padding: "8px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 8,
                        color: t.text,
                        fontSize: 13,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <option value={15}>15분</option>
                      <option value={30}>30분</option>
                      <option value={60}>1시간</option>
                      <option value={120}>2시간</option>
                      <option value={360}>6시간</option>
                    </select>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* MCP 데이터 소스 */}
          <section>
            <h2
              style={{
                color: t.text,
                fontSize: 14,
                fontWeight: 600,
                margin: "0 0 16px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Zap size={16} color={t.primary} />
              MCP 데이터 소스
            </h2>

            {/* ── 공식 (Official) MCP ────────────────────────────── */}
            {[
              {
                label: "공식",
                badge: { bg: "rgba(59,130,246,0.12)", color: "#3b82f6", text: "Official" },
                grouped: groupedOfficial,
              },
              {
                label: "커뮤니티",
                badge: { bg: "rgba(245,158,11,0.12)", color: "#f59e0b", text: "Community" },
                grouped: groupedCommunity,
              },
            ].map(({ label, badge, grouped }) => {
              const allProviders = Object.values(grouped).flat();
              if (allProviders.length === 0) return null;
              return (
                <div key={label} style={{ marginBottom: 28 }}>
                  {/* Section header */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 16,
                      paddingBottom: 8,
                      borderBottom: `1px solid ${t.divider}`,
                    }}
                  >
                    <span
                      style={{
                        color: t.text,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </span>
                    <span
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: badge.bg,
                        color: badge.color,
                        border: `1px solid ${badge.color}40`,
                      }}
                    >
                      {badge.text}
                    </span>
                    <span style={{ color: t.textMuted, fontSize: 11 }}>
                      ({allProviders.filter((p) => p.isEnabled).length}/{allProviders.length})
                    </span>
                  </div>

                  {/* Category sub-groups */}
                  {Object.entries(grouped).map(([category, providers]) => (
                    <div key={category} style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 10,
                        }}
                      >
                        <span
                          style={{
                            color: t.textMuted,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                          }}
                        >
                          {MCP_CATEGORIES[category as keyof typeof MCP_CATEGORIES]?.name || category}
                        </span>
                        <span style={{ color: t.textMuted, fontSize: 11 }}>
                          ({providers.filter((p) => p.isEnabled).length}/{providers.length})
                        </span>
                      </div>

                      <div
                        style={{
                          background: t.surface,
                          borderRadius: 16,
                          overflow: "hidden",
                        }}
                      >
                        {providers.map((provider, index) => (
                          <ProviderCard
                            key={provider.id}
                            provider={provider}
                            isExpanded={expandedProvider === provider.id}
                            onToggleExpand={() =>
                              setExpandedProvider(
                                expandedProvider === provider.id ? null : provider.id
                              )
                            }
                            onToggleEnabled={(enabled) =>
                              updateProvider(provider.id, { isEnabled: enabled })
                            }
                            onUpdateConfig={(config) =>
                              updateProviderConfig(provider.id, config)
                            }
                            showToken={showTokens[provider.id] || false}
                            onToggleToken={() => toggleTokenVisibility(provider.id)}
                            onTestConnection={() => handleTestConnection(provider)}
                            isTesting={testingProvider === provider.id}
                            testResult={testResults[provider.id] ?? null}
                            theme={t}
                            isLast={index === providers.length - 1}
                            localSources={localSources[provider.id] ?? []}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* ── 커스텀 (내부/사내) MCP ──────────────────────────── */}
            {customProviders.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      color: t.textMuted,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    커스텀 (내부)
                  </span>
                  <span
                    style={{
                      padding: "1px 6px",
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      background: "rgba(245,158,11,0.12)",
                      color: "#f59e0b",
                      border: "1px solid rgba(245,158,11,0.25)",
                    }}
                  >
                    커스텀
                  </span>
                  <span style={{ color: t.textMuted, fontSize: 11 }}>
                    ({customProviders.filter((p) => p.isEnabled).length}/{customProviders.length})
                  </span>
                </div>
                <div
                  style={{
                    background: t.surface,
                    borderRadius: 16,
                    overflow: "hidden",
                    border: "1px solid rgba(245,158,11,0.18)",
                  }}
                >
                  {customProviders.map((provider, index) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      isExpanded={expandedProvider === provider.id}
                      onToggleExpand={() =>
                        setExpandedProvider(expandedProvider === provider.id ? null : provider.id)
                      }
                      onToggleEnabled={(enabled) =>
                        setCustomProviders((prev) =>
                          prev.map((p) => p.id === provider.id ? { ...p, isEnabled: enabled } : p)
                        )
                      }
                      onUpdateConfig={() => {}}
                      showToken={showTokens[provider.id] || false}
                      onToggleToken={() => toggleTokenVisibility(provider.id)}
                      onTestConnection={() => handleTestConnection(provider)}
                      isTesting={testingProvider === provider.id}
                      testResult={testResults[provider.id] ?? null}
                      theme={t}
                      isLast={index === customProviders.length - 1}
                    />
                  ))}
                </div>
                <p style={{ color: t.textMuted, fontSize: 11, marginTop: 8, marginLeft: 4 }}>
                  커스텀 MCP는 <code style={{ fontFamily: "monospace" }}>~/.localwiki/mcp-config.yaml</code> 의 <code style={{ fontFamily: "monospace" }}>custom_mcps</code> 섹션에서 관리됩니다.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  );
}

// Toggle Switch 컴포넌트
function ToggleSwitch({
  checked,
  onChange,
  theme,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 48,
        height: 28,
        borderRadius: 14,
        border: "none",
        background: checked ? theme.primary : theme.divider,
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
      }}
    >
      <motion.div
        animate={{ x: checked ? 22 : 2 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: "white",
          position: "absolute",
          top: 2,
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

// Provider Card 컴포넌트
function ProviderCard({
  provider,
  isExpanded,
  onToggleExpand,
  onToggleEnabled,
  onUpdateConfig,
  showToken,
  onToggleToken,
  onTestConnection,
  isTesting,
  testResult,
  theme,
  isLast,
  localSources,
}: {
  provider: MCPProvider;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUpdateConfig: (config: Partial<MCPConfig>) => void;
  showToken: boolean;
  onToggleToken: () => void;
  onTestConnection: () => void;
  isTesting: boolean;
  testResult: { ok: boolean; message: string } | null;
  theme: ReturnType<typeof getTheme>;
  isLast: boolean;
  localSources?: string[];
}) {
  const t = theme;

  return (
    <div
      style={{
        borderBottom: isLast ? "none" : `1px solid ${t.divider}`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "16px 20px",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: provider.isEnabled ? t.primaryLight : t.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: provider.isEnabled ? t.primary : t.textMuted,
            transition: "all 0.2s",
          }}
        >
          <MCPIcon type={provider.icon} size={20} />
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: t.text, fontSize: 14, fontWeight: 500 }}>
              {provider.name}
            </span>
            {provider.isConnected && (
              <span style={{ padding: "2px 8px", background: t.successLight, color: t.success, fontSize: 10, fontWeight: 600, borderRadius: 4 }}>
                연결됨
              </span>
            )}
            {localSources && localSources.length > 0 && (
              <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
                {localSources.join(" · ")}
              </span>
            )}
          </div>
          <p style={{ color: t.textMuted, fontSize: 12, margin: "2px 0 0" }}>
            {provider.description}
          </p>
        </div>

        <ToggleSwitch
          checked={provider.isEnabled}
          onChange={onToggleEnabled}
          theme={t}
        />

        <button
          onClick={onToggleExpand}
          disabled={!provider.isEnabled}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: provider.isEnabled ? t.textSecondary : t.textMuted,
            cursor: provider.isEnabled ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: provider.isEnabled ? 1 : 0.5,
            transition: "all 0.15s",
          }}
        >
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronRight size={18} />
          </motion.div>
        </button>
      </div>

      {/* Expanded Config */}
      <AnimatePresence>
        {isExpanded && provider.isEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                padding: "0 20px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                marginLeft: 52,
              }}
            >
              {/* API Token — hidden for community MCPs with their own config UI */}
              <div style={{ display: (provider.type === "devdb" || provider.type === "oracle" || provider.type === "meta") ? "none" : undefined }}>
                <label
                  style={{
                    display: "block",
                    color: t.textSecondary,
                    fontSize: 12,
                    fontWeight: 500,
                    marginBottom: 6,
                  }}
                >
                  API Token
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input
                      type={showToken ? "text" : "password"}
                      value={provider.config.apiToken || ""}
                      onChange={(e) => onUpdateConfig({ apiToken: e.target.value })}
                      placeholder={provider.type === "github" ? "ghp_xxxxxxxxxxxx" : "sk-xxxx-xxxx-xxxx"}
                      style={{
                        width: "100%",
                        padding: "10px 40px 10px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 10,
                        color: t.text,
                        fontSize: 13,
                        fontFamily: "var(--font-mono), monospace",
                        outline: "none",
                        transition: "border-color 0.15s",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = t.primary;
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = t.divider;
                      }}
                    />
                    <button
                      onClick={onToggleToken}
                      style={{
                        position: "absolute",
                        right: 8,
                        top: "50%",
                        transform: "translateY(-50%)",
                        background: "transparent",
                        border: "none",
                        color: t.textMuted,
                        cursor: "pointer",
                        padding: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Provider-specific fields */}
              {provider.type === "github" && (
                <div>
                  <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                    GitHub Enterprise URL
                  </label>
                  <input
                    type="text"
                    value={provider.config.apiUrl || ""}
                    onChange={(e) => onUpdateConfig({ apiUrl: e.target.value })}
                    placeholder="https://github.company.com"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      color: t.text,
                      fontSize: 13,
                      fontFamily: "inherit",
                      outline: "none",
                      transition: "border-color 0.15s",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = t.primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = t.divider; }}
                  />
                </div>
              )}

              {/* ── devdb: HTTP/SSE endpoint URL ── */}
              {provider.type === "devdb" && (
                <>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      fontSize: 12,
                      color: t.textMuted,
                    }}
                  >
                    <strong style={{ color: t.textSecondary }}>설정 방식</strong>: HTTP/SSE 타입 MCP — serverURL만 지정합니다.
                    <br />
                    <code style={{ fontSize: 11, color: t.primary }}>{`{ "type": "http", "url": "<serverURL>" }`}</code>
                  </div>
                  <div>
                    <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      Server URL (SSE endpoint)
                    </label>
                    <input
                      type="text"
                      value={provider.config.apiUrl || ""}
                      onChange={(e) => onUpdateConfig({ apiUrl: e.target.value })}
                      placeholder="https://mcp-sqlserver-explore-dawi.d3.clouz.io/sse"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 10,
                        color: t.text,
                        fontSize: 13,
                        fontFamily: "var(--font-mono), monospace",
                        outline: "none",
                      }}
                    />
                  </div>
                </>
              )}

              {/* ── oracle: uvx mcp-alchemy + DB_URL ── */}
              {provider.type === "oracle" && (
                <>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      fontSize: 12,
                      color: t.textMuted,
                    }}
                  >
                    <strong style={{ color: t.textSecondary }}>설정 방식</strong>: stdio — <code style={{ fontSize: 11, color: t.primary }}>uvx --with oracledb mcp-alchemy</code>
                    <br />
                    DB_URL 환경변수로 연결합니다. uvx가 설치되어 있으면 별도 설치 불필요.
                  </div>
                  <div>
                    <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      DB_URL <span style={{ color: t.textMuted, fontWeight: 400 }}>(SQLAlchemy 연결 문자열)</span>
                    </label>
                    <input
                      type="text"
                      value={provider.config.dbUrl || ""}
                      onChange={(e) => onUpdateConfig({ dbUrl: e.target.value })}
                      placeholder="oracle+oracledb://USER:PASS@HOST:1521/?service_name=SERVICE"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 10,
                        color: t.text,
                        fontSize: 13,
                        fontFamily: "var(--font-mono), monospace",
                        outline: "none",
                      }}
                    />
                  </div>
                </>
              )}

              {/* ── meta: uv run local script + AD credentials ── */}
              {provider.type === "meta" && (
                <>
                  <div
                    style={{
                      padding: "10px 12px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      fontSize: 12,
                      color: t.textMuted,
                    }}
                  >
                    <strong style={{ color: t.textSecondary }}>설정 방식</strong>: stdio — <code style={{ fontSize: 11, color: t.primary }}>uv run --directory &lt;dir&gt; main.py</code>
                    <br />
                    GMARKET_AD_ID / GMARKET_AD_PWD 환경변수로 인증합니다.
                  </div>
                  <div>
                    <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                      Script Directory
                    </label>
                    <input
                      type="text"
                      value={provider.config.scriptDir || ""}
                      onChange={(e) => onUpdateConfig({ scriptDir: e.target.value })}
                      placeholder="/Users/yourname/toolbox/skills/oh-my-rebuild/mcp/meta"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 10,
                        color: t.text,
                        fontSize: 13,
                        fontFamily: "var(--font-mono), monospace",
                        outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                        AD ID <span style={{ color: t.textMuted, fontWeight: 400 }}>(GMARKET_AD_ID)</span>
                      </label>
                      <input
                        type="text"
                        value={provider.config.username || ""}
                        onChange={(e) => onUpdateConfig({ username: e.target.value })}
                        placeholder="gmarket-id"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          background: t.bg,
                          border: `1px solid ${t.divider}`,
                          borderRadius: 10,
                          color: t.text,
                          fontSize: 13,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                        AD Password <span style={{ color: t.textMuted, fontWeight: 400 }}>(GMARKET_AD_PWD)</span>
                      </label>
                      <input
                        type="password"
                        value={provider.config.password || ""}
                        onChange={(e) => onUpdateConfig({ password: e.target.value })}
                        placeholder="••••••••"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          background: t.bg,
                          border: `1px solid ${t.divider}`,
                          borderRadius: 10,
                          color: t.text,
                          fontSize: 13,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                </>
              )}

              {(provider.type === "jira" || provider.type === "confluence") && (
                <div>
                  <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                    {provider.type === "jira" ? "Jira Host URL" : "Confluence Host URL"}
                  </label>
                  <input
                    type="text"
                    value={provider.config.apiUrl || ""}
                    onChange={(e) => onUpdateConfig({ apiUrl: e.target.value })}
                    placeholder={provider.type === "jira" ? "https://jira.company.com" : "https://wiki.company.com"}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      color: t.text,
                      fontSize: 13,
                      fontFamily: "inherit",
                      outline: "none",
                      transition: "border-color 0.15s",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = t.primary; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = t.divider; }}
                  />
                </div>
              )}

              {(provider.type === "postgresql" || provider.type === "mysql" || provider.type === "mongodb") && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
                    <div>
                      <label
                        style={{
                          display: "block",
                          color: t.textSecondary,
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 6,
                        }}
                      >
                        Host
                      </label>
                      <input
                        type="text"
                        value={provider.config.host || ""}
                        onChange={(e) => onUpdateConfig({ host: e.target.value })}
                        placeholder="localhost"
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          background: t.bg,
                          border: `1px solid ${t.divider}`,
                          borderRadius: 10,
                          color: t.text,
                          fontSize: 13,
                          fontFamily: "inherit",
                          outline: "none",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          color: t.textSecondary,
                          fontSize: 12,
                          fontWeight: 500,
                          marginBottom: 6,
                        }}
                      >
                        Port
                      </label>
                      <input
                        type="number"
                        value={provider.config.port || ""}
                        onChange={(e) => onUpdateConfig({ port: parseInt(e.target.value) || undefined })}
                        placeholder={provider.type === "postgresql" ? "5432" : provider.type === "mysql" ? "3306" : "27017"}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          background: t.bg,
                          border: `1px solid ${t.divider}`,
                          borderRadius: 10,
                          color: t.text,
                          fontSize: 13,
                          fontFamily: "var(--font-mono), monospace",
                          outline: "none",
                        }}
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      style={{
                        display: "block",
                        color: t.textSecondary,
                        fontSize: 12,
                        fontWeight: 500,
                        marginBottom: 6,
                      }}
                    >
                      Database
                    </label>
                    <input
                      type="text"
                      value={provider.config.database || ""}
                      onChange={(e) => onUpdateConfig({ database: e.target.value })}
                      placeholder="database_name"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        background: t.bg,
                        border: `1px solid ${t.divider}`,
                        borderRadius: 10,
                        color: t.text,
                        fontSize: 13,
                        fontFamily: "inherit",
                        outline: "none",
                      }}
                    />
                  </div>
                </>
              )}

              {/* Test Connection Button */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={onTestConnection}
                    disabled={isTesting}
                    style={{
                      padding: "10px 16px",
                      background: t.bg,
                      border: `1px solid ${t.divider}`,
                      borderRadius: 10,
                      color: isTesting ? t.textMuted : t.text,
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: isTesting ? "default" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontFamily: "inherit",
                      transition: "all 0.15s",
                      opacity: isTesting ? 0.7 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isTesting) {
                        e.currentTarget.style.borderColor = t.primary;
                        e.currentTarget.style.color = t.primary;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = t.divider;
                      e.currentTarget.style.color = isTesting ? t.textMuted : t.text;
                    }}
                  >
                    <RefreshCw size={14} style={{ animation: isTesting ? "spin 1s linear infinite" : "none" }} />
                    {isTesting ? "테스트 중..." : "연결 테스트"}
                  </button>
                  <a
                    href="#"
                    style={{
                      padding: "10px 16px",
                      color: t.textSecondary,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      textDecoration: "none",
                    }}
                  >
                    <ExternalLink size={14} />
                    문서 보기
                  </a>
                </div>
                {testResult && testResult.message && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: testResult.ok ? t.successLight : "rgba(239,68,68,0.08)",
                      border: `1px solid ${testResult.ok ? t.success : "rgba(239,68,68,0.3)"}`,
                      color: testResult.ok ? t.success : "#ef4444",
                      fontSize: 12,
                      fontWeight: 500,
                      lineHeight: 1.5,
                    }}
                  >
                    {testResult.message}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
