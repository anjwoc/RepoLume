"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings, ArrowLeft, Database, MessageSquare,
  FolderKanban, Check, X, Eye, EyeOff, RefreshCw,
  ChevronRight, Zap, Shield, Clock, ExternalLink,
  Plus, Trash2
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
  appSettings: { language: string; languages?: string[]; provider: string; model: string; mode?: string; apiKey?: string };
  onSaveAppSettings: (settings: Partial<{ language: string; languages: string[]; provider: string; model: string; mode: string; apiKey: string; setupComplete: boolean }>) => void;
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
    case "notion":
    case "linear":
      return <FolderKanban size={size} />;
    case "slack":
      return <MessageSquare size={size} />;
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
  });
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);

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




  const toggleTokenVisibility = (providerId: string) => {
    setShowTokens((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  const groupedProviders = settings.providers.reduce((acc, provider) => {
    const category = provider.category;
    if (!acc[category]) acc[category] = [];
    acc[category].push(provider);
    return acc;
  }, {} as Record<string, MCPProvider[]>);

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
                    <option value="gemini-3.1-flash">gemini-3.1-flash (빠름, 기본)</option>
                    <option value="gemini-3.1-pro">gemini-3.1-pro (고성능)</option>
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

            {Object.entries(groupedProviders).map(([category, providers]) => (
              <div key={category} style={{ marginBottom: 24 }}>
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
                    {MCP_CATEGORIES[category as keyof typeof MCP_CATEGORIES]?.name || category}
                  </span>
                  <span
                    style={{
                      color: t.textMuted,
                      fontSize: 11,
                    }}
                  >
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
                      theme={t}
                      isLast={index === providers.length - 1}
                    />
                  ))}
                </div>
              </div>
            ))}
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
  theme,
  isLast,
}: {
  provider: MCPProvider;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUpdateConfig: (config: Partial<MCPConfig>) => void;
  showToken: boolean;
  onToggleToken: () => void;
  theme: ReturnType<typeof getTheme>;
  isLast: boolean;
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: t.text, fontSize: 14, fontWeight: 500 }}>
              {provider.name}
            </span>
            {provider.isConnected && (
              <span
                style={{
                  padding: "2px 8px",
                  background: t.successLight,
                  color: t.success,
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 4,
                }}
              >
                연결됨
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
              {/* API Token */}
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
                  API Token
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <input
                      type={showToken ? "text" : "password"}
                      value={provider.config.apiToken || ""}
                      onChange={(e) => onUpdateConfig({ apiToken: e.target.value })}
                      placeholder="sk-xxxx-xxxx-xxxx"
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
              {(provider.type === "github") && (
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
                    Repository (선택)
                  </label>
                  <input
                    type="text"
                    value={provider.config.repository || ""}
                    onChange={(e) => onUpdateConfig({ repository: e.target.value })}
                    placeholder="owner/repo"
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
              )}

              {(provider.type === "jira" || provider.type === "confluence") && (
                <>
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
                      API URL
                    </label>
                    <input
                      type="text"
                      value={provider.config.apiUrl || ""}
                      onChange={(e) => onUpdateConfig({ apiUrl: e.target.value })}
                      placeholder="https://your-domain.atlassian.net"
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
                      Username (Email)
                    </label>
                    <input
                      type="text"
                      value={provider.config.username || ""}
                      onChange={(e) => onUpdateConfig({ username: e.target.value })}
                      placeholder="your-email@company.com"
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
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  style={{
                    padding: "10px 16px",
                    background: t.bg,
                    border: `1px solid ${t.divider}`,
                    borderRadius: 10,
                    color: t.text,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "inherit",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = t.primary;
                    e.currentTarget.style.color = t.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = t.divider;
                    e.currentTarget.style.color = t.text;
                  }}
                >
                  <RefreshCw size={14} />
                  연결 테스트
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
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
