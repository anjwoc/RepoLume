"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle, ChevronRight, ChevronLeft, Rocket, Globe, Terminal, ExternalLink, RefreshCw, AlertCircle, FolderOpen, ShieldCheck, Loader2 } from "lucide-react";
import { getTheme } from "@/lib/theme";
import { BACKEND_URL } from "@/lib/backend-url";
import { openPrivacySettings, probeFolderAccess, selectProjectFolder } from "@/lib/desktop-folder-picker";

export const PERMISSION_GUIDE_VERSION = 1;

export interface AppSettings {
  mode: "cli" | "api";
  model: string;
  provider: string;
  language: string;        // primary (backward compat)
  languages: string[];     // 다국어 동시 생성 목록
  apiKey: string;
  setupComplete: boolean;
  repositoryBaseUrl?: string;
  hoverBgColor?: string;
  pageConcurrency?: number; // 동시 페이지 생성 수 (1-10, 기본 3)
  preauthorizedPath?: string;
  permissionGuideVersion?: number;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  mode: "cli",
  model: "gpt-5.5",
  provider: "openai",
  language: "ko",
  languages: ["ko"],
  apiKey: "",
  setupComplete: false,
};

const MODELS = [
  { group: "Codex (ChatGPT)", items: [
    { value: "gpt-5.5-mini", label: "gpt-5.5-mini", desc: "빠름 (기본)", provider: "openai" },
    { value: "gpt-5.5", label: "gpt-5.5", desc: "고성능", provider: "openai" },
  ]},
  { group: "Gemini", items: [
    { value: "gemini-2.5-flash", label: "gemini-2.5-flash", desc: "빠름 (기본)", provider: "google" },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro", desc: "고성능", provider: "google" },
  ]},
  { group: "Claude", items: [
    { value: "claude-haiku-3-5", label: "claude-haiku-3-5", desc: "빠름 (기본)", provider: "anthropic" },
    { value: "claude-sonnet-4-5", label: "claude-sonnet-4-5", desc: "고성능", provider: "anthropic" },
  ]},
  { group: "Antigravity CLI", items: [
    { value: "agy-gemini-3.5-flash-medium", label: "Gemini 3.5 Flash (Medium)", desc: "Fast ⓘ", provider: "antigravity" },
    { value: "agy-gemini-3.5-flash-high", label: "Gemini 3.5 Flash (High)", desc: "Fast ⓘ", provider: "antigravity" },
    { value: "agy-gemini-3.5-flash-low", label: "Gemini 3.5 Flash (Low)", desc: "Fast ⓘ", provider: "antigravity" },
    { value: "agy-gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)", desc: "", provider: "antigravity" },
    { value: "agy-gemini-3.1-pro-high", label: "Gemini 3.1 Pro (High)", desc: "", provider: "antigravity" },
    { value: "agy-claude-sonnet-4.6-thinking", label: "Claude Sonnet 4.6 (Thinking) ⚠️", desc: "", provider: "antigravity" },
    { value: "agy-claude-opus-4.6-thinking", label: "Claude Opus 4.6 (Thinking) ⚠️", desc: "", provider: "antigravity" },
    { value: "agy-gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium) ⚠️", desc: "", provider: "antigravity" },
  ]},
];

const APP_SETTINGS_KEY = "repolume_app_settings";

interface SetupWizardProps {
  isDark: boolean;
  onComplete: (settings: AppSettings) => void;
}

export function SetupWizard({ isDark, onComplete }: SetupWizardProps) {
  const t = getTheme(isDark);
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<"cli" | "api">("cli");
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-5.5");
  const [selectedProvider, setSelectedProvider] = useState("openai");
  const [preauthorizedPath, setPreauthorizedPath] = useState("");
  const [permissionState, setPermissionState] = useState<"idle" | "selecting" | "ready" | "denied">("idle");
  const [permissionError, setPermissionError] = useState("");
  const [permissionSummary, setPermissionSummary] = useState("");

  // Antigravity CLI Auth States
  const [agyAuthStatus, setAgyAuthStatus] = useState<"idle" | "checking" | "needs_auth" | "authenticating" | "success" | "error">("idle");
  const [agyAuthUrl, setAgyAuthUrl] = useState("");
  const [agyAuthCode, setAgyAuthCode] = useState("");
  const [agyAuthError, setAgyAuthError] = useState("");

  useEffect(() => {
    if (selectedProvider === "antigravity" && mode === "cli") {
      checkAgyAuthStatus();
    } else {
      setAgyAuthStatus("idle");
    }
  }, [selectedProvider, mode]);

  const checkAgyAuthStatus = async () => {
    setAgyAuthStatus("checking");
    try {
      const res = await fetch(`${BACKEND_URL}/agent/auth/status`);
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
      const res = await fetch(`${BACKEND_URL}/agent/auth/start`, { method: "POST" });
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
      const res = await fetch(`${BACKEND_URL}/agent/auth/submit`, {
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

  const steps = [
    { num: 1, label: "폴더 권한" },
    { num: 2, label: "실행 모드" },
    { num: 3, label: "모델 선택" },
  ];

  const selectPermissionFolder = async () => {
    setPermissionState("selecting");
    setPermissionError("");
    setPermissionSummary("");
    try {
      const selection = await selectProjectFolder();
      if (selection.cancelled) {
        setPermissionState("idle");
        return;
      }
      const access = await probeFolderAccess(selection.path);
      if (!access.readable) {
        setPermissionState("denied");
        setPermissionError(access.error || "선택한 폴더를 읽을 수 없습니다.");
        return;
      }
      setPreauthorizedPath(selection.path);
      setPermissionSummary(`${access.directoriesChecked.toLocaleString()}개 폴더와 ${access.filesChecked.toLocaleString()}개 파일 표본 확인`);
      setPermissionState("ready");
    } catch (error) {
      setPermissionState("denied");
      setPermissionError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleComplete = () => {
    if (permissionState !== "ready" || !preauthorizedPath) {
      setStep(1);
      return;
    }
    const settings: AppSettings = {
      mode,
      model: selectedModel,
      provider: selectedProvider,
      language: "ko",
      languages: ["ko"],
      apiKey: mode === "api" ? apiKey : "",
      setupComplete: true,
      preauthorizedPath,
      permissionGuideVersion: PERMISSION_GUIDE_VERSION,
    };
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    onComplete(settings);
  };

  const StepDots = () => (
    <div style={{ display: "flex", gap: 8, marginBottom: 40, alignItems: "center" }}>
      {steps.map((s, i) => (
        <div key={s.num} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: step >= s.num ? t.primary : t.surface,
            color: step >= s.num ? "#fff" : t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 600, transition: "all 0.3s",
            border: `2px solid ${step >= s.num ? t.primary : t.divider}`,
          }}>
            {step > s.num ? <CheckCircle size={14} /> : s.num}
          </div>
          <span style={{ fontSize: 12, color: step >= s.num ? t.text : t.textMuted, fontWeight: step === s.num ? 600 : 400 }}>
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <div style={{ width: 32, height: 2, background: step > s.num ? t.primary : t.divider, borderRadius: 2, marginInline: 4, transition: "all 0.3s" }} />
          )}
        </div>
      ))}
    </div>
  );

  const card = {
    background: t.surface, borderRadius: 24, padding: "40px 48px",
    width: 520, boxShadow: t.floatingShadow,
    maxHeight: "85vh", overflowY: "auto",
  } as const;

  const nextBtn = (onClick: () => void, label = "다음", disabled = false) => (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 2, padding: "13px", borderRadius: 12, border: "none",
      background: disabled ? t.divider : t.primary,
      color: disabled ? t.textMuted : "#fff",
      fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6, transition: "all 0.2s",
    }}>
      {label} <ChevronRight size={16} />
    </button>
  );

  const prevBtn = (onClick: () => void) => (
    <button onClick={onClick} style={{
      flex: 1, padding: "13px", borderRadius: 12,
      border: `1.5px solid ${t.divider}`, background: "transparent",
      color: t.textSecondary, fontSize: 14, fontWeight: 600, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    }}>
      <ChevronLeft size={16} /> 이전
    </button>
  );

  return (
    <div style={{
      width: "100%", height: "100vh", background: t.bg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif",
    }}>
      <StepDots />

      <AnimatePresence mode="wait">

        {step === 1 && (
          <motion.div key="permission" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }} style={card}>
            <div style={{ width: 44, height: 44, borderRadius: 14, background: t.primaryLight, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <FolderOpen size={22} color={t.primary} />
            </div>
            <h1 style={{ color: t.text, fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>프로젝트 폴더 접근 준비</h1>
            <p style={{ color: t.textSecondary, fontSize: 14, margin: "0 0 22px", lineHeight: 1.65 }}>
              분석 중 권한 팝업이 작업을 멈추지 않도록 지금 먼저 승인합니다. macOS 팝업이 나타나면 반드시 <b>허용</b>을 눌러 주세요.
            </p>
            <div style={{ display: "grid", gap: 10, marginBottom: 22 }}>
              {[
                ["1", "폴더 선택", "표준 macOS 창에서 분석할 저장소를 선택합니다."],
                ["2", "전체 트리 사전 검사", "실제 분석 프로세스가 하위 폴더와 코드 파일을 읽도록 미리 확인합니다."],
                ["3", "분석 잠금 해제", "검사가 완료된 프로젝트만 분석 기능을 사용할 수 있습니다."],
              ].map(([number, title, description]) => (
                <div key={number} style={{ display: "flex", gap: 12, padding: 12, border: `1px solid ${t.divider}`, borderRadius: 12, background: t.bg }}>
                  <span style={{ width: 24, height: 24, borderRadius: 8, background: t.surface, color: t.primary, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{number}</span>
                  <div><div style={{ color: t.text, fontSize: 13, fontWeight: 650 }}>{title}</div><div style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.5, marginTop: 2 }}>{description}</div></div>
                </div>
              ))}
            </div>
            <button onClick={selectPermissionFolder} disabled={permissionState === "selecting"} style={{ width: "100%", padding: 13, borderRadius: 12, border: `1px solid ${permissionState === "ready" ? t.success : t.primary}`, background: permissionState === "ready" ? t.successLight : t.primaryLight, color: permissionState === "ready" ? t.success : t.primary, fontSize: 14, fontWeight: 650, cursor: permissionState === "selecting" ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 12 }}>
              {permissionState === "selecting" ? <Loader2 size={16} className="animate-spin" /> : permissionState === "ready" ? <ShieldCheck size={16} /> : <FolderOpen size={16} />}
              {permissionState === "selecting" ? "권한 확인 중" : permissionState === "ready" ? "폴더 접근 준비 완료" : "프로젝트 폴더 선택"}
            </button>
            {preauthorizedPath && <div style={{ color: t.textSecondary, fontSize: 12, padding: "8px 10px", borderRadius: 8, background: t.bg, wordBreak: "break-all", marginBottom: 12 }}>{preauthorizedPath}</div>}
            {permissionState === "selecting" && <div style={{ color: t.textSecondary, fontSize: 12, marginBottom: 12, lineHeight: 1.55 }}>macOS 권한 창이 다른 창 앞에 열릴 수 있습니다. 팝업에서 <b>허용</b>을 선택하면 자동으로 계속됩니다.</div>}
            {permissionState === "ready" && permissionSummary && <div style={{ color: t.success, fontSize: 12, marginBottom: 12, display: "flex", gap: 6 }}><CheckCircle size={14} />{permissionSummary}</div>}
            {permissionState === "denied" && <div style={{ color: t.error, fontSize: 12, marginBottom: 12, display: "flex", gap: 6 }}><AlertCircle size={14} />{permissionError}</div>}
            {permissionState === "denied" && <button onClick={() => void openPrivacySettings()} style={{ width: "100%", padding: 11, marginBottom: 12, borderRadius: 10, border: `1px solid ${t.divider}`, background: t.bg, color: t.textSecondary, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>시스템 설정에서 파일 권한 열기</button>}
            <div style={{ display: "flex", gap: 10 }}>
              {nextBtn(() => setStep(2), "권한 확인 후 계속", permissionState !== "ready")}
            </div>
          </motion.div>
        )}

        {/* ─── Step 1: 실행 모드 ─── */}
        {step === 2 && (
          <motion.div key="step2" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }} style={card}>
            <h1 style={{ color: t.text, fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>👋 시작하기</h1>
            <p style={{ color: t.textSecondary, fontSize: 14, margin: "0 0 28px", lineHeight: 1.6 }}>
              AI를 어떻게 실행하시겠어요?
            </p>

            <div style={{ display: "flex", gap: 14, marginBottom: 32 }}>
              {[
                {
                  value: "cli" as const,
                  icon: Terminal,
                  title: "로컬 CLI 모드",
                  desc: "서버 환경변수에 설정된\nAPI 키 또는 로컬 CLI 도구 사용",
                  badge: "추천",
                },
                {
                  value: "api" as const,
                  icon: Globe,
                  title: "API 키 직접 입력",
                  desc: "이 앱에서 직접\nAPI 키를 입력해서 사용",
                  badge: null,
                },
              ].map((opt) => {
                const selected = mode === opt.value;
                const Icon = opt.icon;
                return (
                  <button key={opt.value} onClick={() => setMode(opt.value)} style={{
                    flex: 1, padding: "20px 16px", borderRadius: 16, textAlign: "left", cursor: "pointer",
                    border: `2px solid ${selected ? t.primary : t.divider}`,
                    background: selected ? t.primaryLight : t.bg,
                    transition: "all 0.2s", position: "relative",
                  }}>
                    {opt.badge && (
                      <span style={{
                        position: "absolute", top: 10, right: 10,
                        background: t.primary, color: "#fff",
                        fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                      }}>{opt.badge}</span>
                    )}
                    <Icon size={22} color={selected ? t.primary : t.textSecondary} style={{ marginBottom: 10 }} />
                    <p style={{ color: t.text, fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>{opt.title}</p>
                    <p style={{ color: t.textSecondary, fontSize: 12, margin: 0, lineHeight: 1.6, whiteSpace: "pre-line" }}>{opt.desc}</p>
                  </button>
                );
              })}
            </div>

            {mode === "api" && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", color: t.textSecondary, fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-...  /  AIza...  /  sk-ant-..."
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10,
                    border: `1.5px solid ${t.divider}`, background: t.bg, color: t.text,
                    fontSize: 14, outline: "none", boxSizing: "border-box",
                  }}
                />
                <p style={{ fontSize: 11, color: t.textMuted, margin: "6px 0 0" }}>
                  선택한 모델(OpenAI / Google / Anthropic)의 키를 입력하세요
                </p>
              </div>
            )}

            {mode === "cli" && (
              <div style={{
                padding: "12px 16px", borderRadius: 12, background: t.primaryLight,
                border: `1px solid ${t.primaryBorder}`, marginBottom: 20,
              }}>
                <p style={{ color: t.primary, fontSize: 13, margin: 0, fontWeight: 500 }}>
                  ✅ 백엔드 서버 환경변수의 API 키를 자동으로 사용합니다
                </p>
              </div>
            )}

            <div style={{ display: "flex", gap: 12 }}>{prevBtn(() => setStep(1))}{nextBtn(() => setStep(3))}</div>
          </motion.div>
        )}

        {/* ─── Step 2: 모델 ─── */}
        {step === 3 && (
          <motion.div key="step3" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ duration: 0.25 }} style={card}>
            <h2 style={{ color: t.text, fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>AI 모델 선택</h2>
            <p style={{ color: t.textSecondary, fontSize: 13, margin: "0 0 24px", lineHeight: 1.6 }}>위키 생성에 사용할 AI 모델을 선택하세요.</p>

            {MODELS.map((group) => (
              <div key={group.group} style={{ marginBottom: 18 }}>
                <p style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase", margin: "0 0 8px" }}>
                  {group.group}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {group.items.map((m) => {
                    const selected = selectedModel === m.value;
                    return (
                      <button key={m.value} onClick={() => { setSelectedModel(m.value); setSelectedProvider(m.provider); }} style={{
                        padding: "12px 16px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                        border: `2px solid ${selected ? t.primary : t.divider}`,
                        background: selected ? t.primaryLight : t.bg,
                        display: "flex", alignItems: "center", justifyContent: "space-between", transition: "all 0.2s",
                      }}>
                        <div>
                          <span style={{ color: t.text, fontWeight: 600, fontSize: 14 }}>{m.label}</span>
                          <span style={{ color: t.textSecondary, fontSize: 12, marginLeft: 8 }}>{m.desc}</span>
                        </div>
                        {selected && <CheckCircle size={16} color={t.primary} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {prevBtn(() => setStep(2))}
              <button onClick={handleComplete} disabled={selectedProvider === "antigravity" && agyAuthStatus !== "success"} style={{
                flex: 2, padding: "13px", borderRadius: 12, border: "none",
                background: (selectedProvider === "antigravity" && agyAuthStatus !== "success") ? t.divider : t.primary,
                color: (selectedProvider === "antigravity" && agyAuthStatus !== "success") ? t.textMuted : "#fff",
                fontSize: 15, fontWeight: 700,
                cursor: (selectedProvider === "antigravity" && agyAuthStatus !== "success") ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <Rocket size={17} /> 작업공간 열기
              </button>
            </div>

            {/* Antigravity CLI Auth UI */}
            {selectedProvider === "antigravity" && mode === "cli" && (
              <div style={{ marginTop: 24, padding: 16, background: t.bg, borderRadius: 12, border: `1px solid ${t.divider}` }}>
                <p style={{ color: t.text, fontSize: 13, fontWeight: 700, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
                  <Terminal size={14} /> Antigravity CLI 인증
                </p>

                {agyAuthStatus === "checking" && <p style={{ color: t.textSecondary, fontSize: 12, margin: 0 }}><RefreshCw size={12} style={{ animation: "spin 1s linear infinite", marginRight: 4 }} /> 인증 상태 확인 중...</p>}

                {agyAuthStatus === "success" && <p style={{ color: t.success || "#10b981", fontSize: 13, margin: 0, fontWeight: 600 }}>✅ 인증이 완료되었습니다. 시작할 수 있습니다!</p>}

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

          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
