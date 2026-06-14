"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { StreamLogViewer } from "@/components/stream-log-viewer";

const DARK_MODE_KEY = "localwiki_is_dark";

function AnalyzingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [isDark, setIsDark] = useState(false);

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

  // Wiki destination params (set by home page when dispatching analysis)
  const owner = params.get("owner") || "local";
  const repo = params.get("repo") || projectPath.replace(/\/+$/, "").split("/").pop() || "project";
  const repoType = params.get("repo_type") || "local";

  const handleComplete = () => {
    const wikiParams = new URLSearchParams({
      repo_type: repoType,
      language,
      languages: languages.join(","),
    });
    if (model) wikiParams.set("model", model);
    router.push(`/wiki/${owner}/${repo}?${wikiParams.toString()}`);
  };

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
