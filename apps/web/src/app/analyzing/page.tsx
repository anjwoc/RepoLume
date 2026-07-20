"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StreamLogViewer } from "@/components/stream-log-viewer";
import { openPrivacySettings, probeFolderAccess } from "@/lib/desktop-folder-picker";

const DARK_MODE_KEY = "repolume_is_dark";

function AnalyzingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [isDark, setIsDark] = useState(false);
  const [permissionGate, setPermissionGate] = useState<{ status: "checking" | "ready" | "denied"; error?: string }>({ status: "checking" });

  useEffect(() => {
    setIsDark(localStorage.getItem(DARK_MODE_KEY) === "true");
  }, []);

  const projectPath = params.get("path") || "";
  const pathsRaw = params.get("paths");
  const businessProjectPaths = pathsRaw ? pathsRaw.split(",").filter(Boolean) : [projectPath];
  const testMode = params.get("testMode") === "true";
  const enableBusiness = params.get("enableBusiness") === "true";
  const provider = params.get("provider") || "google";
  const model = params.get("model") || "";
  const mode = (params.get("mode") as "cli" | "api") || "cli";
  const cliTool = params.get("cliTool") || "gemini";
  const apiKey = params.get("apiKey") || "";
  const language = params.get("language") || "ko";
  const languages = params.get("languages")?.split(",").filter(Boolean) || [language];
  const pageConcurrency = Number(params.get("pageConcurrency") || "3") || 3;
  const businessFlowOnly = params.get("businessFlowOnly") === "true";

  useEffect(() => {
    let cancelled = false;
    const checkAccess = async () => {
      setPermissionGate({ status: "checking" });
      for (const path of businessProjectPaths) {
        const result = await probeFolderAccess(path);
        if (cancelled) return;
        if (!result.readable) {
          setPermissionGate({ status: "denied", error: result.error || `${path} 접근이 거부되었습니다.` });
          return;
        }
      }
      if (!cancelled) setPermissionGate({ status: "ready" });
    };
    void checkAccess();
    return () => { cancelled = true; };
  // Re-run only when the URL's selected paths change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, pathsRaw]);

  // Wiki destination params (set by home page when dispatching analysis)
  const owner = params.get("owner") || "local";
  const repo = params.get("repo") || projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  const repoType = params.get("repo_type") || "local";

  const handleComplete = async () => {
    try {
      const res = await fetch("/api/wiki/projects");
      if (res.ok) {
        const projects: { owner: string; repo: string; language: string; slug?: string }[] = await res.json();
        const match = projects.find(p => p.owner === owner && p.repo === repo && p.language === language);
        if (match?.slug) {
          router.push(`/wiki/${match.slug}`);
          return;
        }
      }
    } catch {}
    const wikiParams = new URLSearchParams({
      repo_type: repoType,
      language,
      languages: languages.join(","),
    });
    if (model) wikiParams.set("model", model);
    router.push(`/wiki/${owner}/${repo}?${wikiParams.toString()}`);
  };

  if (permissionGate.status !== "ready") {
    return (
      <div className={isDark ? "dark" : ""} style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: isDark ? "#121212" : "#f8fafc", color: isDark ? "#f8fafc" : "#0f172a" }}>
        <div style={{ width: 460, padding: 28, borderRadius: 18, background: isDark ? "#1e1e1e" : "#fff", boxShadow: "0 18px 50px rgba(15,23,42,.12)" }}>
          <div style={{ fontSize: 18, fontWeight: 750, marginBottom: 10 }}>{permissionGate.status === "checking" ? "프로젝트 권한을 최종 확인하고 있습니다" : "파일 접근 권한이 필요합니다"}</div>
          <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.65, color: isDark ? "#a3a3a3" : "#64748b" }}>{permissionGate.status === "checking" ? "macOS 권한 팝업이 보이면 허용을 눌러 주세요. 이 검사가 끝나기 전에는 분석 프로세스를 시작하지 않습니다." : permissionGate.error}</p>
          {permissionGate.status === "denied" && <div style={{ display: "flex", gap: 8 }}><button onClick={() => void openPrivacySettings()} style={{ flex: 1, padding: 11, border: 0, borderRadius: 10, background: "#2563eb", color: "#fff", fontWeight: 650, cursor: "pointer" }}>시스템 설정 열기</button><button onClick={() => router.push("/")} style={{ flex: 1, padding: 11, borderRadius: 10, border: "1px solid #cbd5e1", background: "transparent", color: "inherit", fontWeight: 650, cursor: "pointer" }}>홈으로 돌아가기</button></div>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={isDark ? "dark" : ""}
      style={{ width: "100%", height: "100vh", overflow: "hidden", background: isDark ? "#121212" : "#fff" }}
    >
      <StreamLogViewer
        isDark={isDark}
        projectPath={projectPath}
        businessProjectPaths={businessProjectPaths}
        language={language}
        languages={languages}
        testMode={testMode}
        enableBusiness={enableBusiness}
        provider={provider}
        model={model}
        mode={mode}
        cliTool={cliTool}
        apiKey={apiKey}
        pageConcurrency={pageConcurrency}
        businessFlowOnly={businessFlowOnly}
        onComplete={handleComplete}
        onCancel={() => router.push("/")}
      />
    </div>
  );
}

export default function AnalyzingPage() {
  return (
    <Suspense fallback={<div style={{ width: "100%", height: "100vh" }} />}>
      <AnalyzingContent />
    </Suspense>
  );
}
