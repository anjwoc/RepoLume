"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { StreamLog, AnalysisPhase, ANALYSIS_PHASES } from "@/lib/stream-types";
import { projectConversationEvents, type ConversationItem } from "@/lib/conversation-events";

export interface DebugEvent {
  id: string;
  ts: number;
  phase: string;
  type: string;
  message: string;
}
import {
  calculateTotalProgress, updatePhaseStatus, addLogToPhase, completePhase, generateId,
} from "@/lib/analysis-utils";
import type { WikiStructureResult } from "@/lib/wiki-generator";

type ApprovalDecision =
  | { action: 'approve' }
  | { action: 'regenerate'; feedback: string }
  | { action: 'cancel' };

const ADMIN_LOGS_KEY = "localwiki_admin_logs";

function maskPrompt(text: string): string {
  const PATTERNS = [
    /You are an expert technical writer[\s\S]{0,2000}?(?=\n\n|$)/gi,
    /Analyze this repository[\s\S]{0,3000}?(?=Output MUST be|$)/gi,
    /IMPORTANT:\s*The wiki content[\s\S]{0,500}?(?=\n|$)/gi,
    /### Mermaid Diagram Rules[\s\S]{0,500}?(?=\n\n|$)/gi,
    /### Naming Conventions[\s\S]{0,500}?(?=\n\n|$)/gi,
  ];
  let masked = text;
  for (const p of PATTERNS) masked = masked.replace(p, '[SYSTEM PROMPT 감충]');
  return masked;
}

function sanitizeRepoName(path: string): string {
  const raw = path.replace(/\/+$/, "").replace(/\\/g, "/").split("/").pop() || "project";
  return raw
    .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.\-]+|[_.\-]+$/g, "")
    || "project";
}

export interface PipelineStateProps {
  projectPath: string;
  businessProjectPaths?: string[];
  language: string;
  testMode: boolean;
  /** ⚗️ TEMP: business flow 페이지만 생성하는 테스트 모드 — 운영 배포 시 제거 */
  businessFlowOnly?: boolean;
  provider: string;
  model: string;
  apiKey?: string;
  mode?: "cli" | "api";
  cliTool?: string;
  enableBusiness?: boolean;
  pageConcurrency?: number;
  onComplete: () => void;
}

export function usePipelineState({
  projectPath,
  businessProjectPaths,
  language,
  testMode,
  businessFlowOnly,
  provider,
  model,
  apiKey,
  mode = "cli",
  cliTool,
  enableBusiness,
  pageConcurrency,
  onComplete,
}: PipelineStateProps) {
  const projectName = projectPath?.split("/").filter(Boolean).pop() || "my-project";

  const [phases, setPhases] = useState<AnalysisPhase[]>(() =>
    ANALYSIS_PHASES.map((p) => ({ ...p, status: "pending", progress: 0, logs: [] }))
  );
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(() =>
    new Set(mode === "cli" ? ANALYSIS_PHASES.map(p => p.id) : [ANALYSIS_PHASES[0].id])
  );
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [pendingStructure, setPendingStructure] = useState<WikiStructureResult | null>(null);
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const [conversationItems, setConversationItems] = useState<ConversationItem[]>([]);

  const approvalRef = useRef<((d: ApprovalDecision) => void) | null>(null);
  const streamingLogRef = useRef<{ logId: string; phaseIndex: number } | null>(null);
  const debugIdRef = useRef(0);
  const activeStreamIdRef = useRef<string | null>(null);
  const jobFinishedRef = useRef(false);
  const stopSignalRef = useRef({ stopped: false });
  const [isStopped, setIsStopped] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const finalizeStreamingLog = () => { streamingLogRef.current = null; };

  const appendToLog = (phaseIndex: number, logId: string, text: string) => {
    setPhases(prev => prev.map((phase, idx) => {
      if (idx !== phaseIndex) return phase;
      return {
        ...phase,
        logs: phase.logs.map(log =>
          log.id === logId ? { ...log, content: log.content + text } : log
        ),
      };
    }));
  };

  useEffect(() => {
    fetch("/api/settings/mcp_settings")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const providers: any[] = data?.value?.providers ?? [];
        setMcpEnabled(providers.some((p: any) => p.isEnabled === true));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let isCancelled = false;
    let jobPhaseStarted = false; // Strict Mode 이중 실행 방지: phase_start 이벤트 수신 후에만 interrupt 허용
    stopSignalRef.current = { stopped: false };
    const streamId = generateId();
    activeStreamIdRef.current = streamId;
    jobFinishedRef.current = false;

    const addLogImmediate = (phaseIndex: number, log: StreamLog, max: number) => {
      setPhases(prev => {
        if (prev[phaseIndex]?.logs.some(l => l.id === log.id)) return prev;
        return addLogToPhase(prev, phaseIndex, log, max);
      });
    };

    const loadDynamic = async () => {
      const { createTaskStream } = await import("@/lib/taskStreamClient");
      const { runWikiStructure, runWikiGeneration } = await import("@/lib/wiki-generator");

      const stream = createTaskStream(streamId, {
        onEvent: (event: any) => {
          if (isCancelled) return;
          setConversationItems((current) => projectConversationEvents([event], current));

          // Debug panel: capture all events including heartbeats
          if (process.env.NEXT_PUBLIC_DEBUG_PANEL === 'true') {
            setDebugEvents(prev => {
              const entry: DebugEvent = {
                id: `dbg-${debugIdRef.current++}`,
                ts: event.ts ?? Date.now(),
                phase: event.phase ?? 'system',
                type: event.type ?? 'unknown',
                message: (event.message ?? JSON.stringify(event.data ?? {})).slice(0, 200),
              };
              const next = [...prev, entry];
              return next.length > 200 ? next.slice(next.length - 200) : next;
            });
          }

          if (event.type === "heartbeat") return;

          const phaseId = event.phase || "generation";
          let phaseIndex = ANALYSIS_PHASES.findIndex(p => p.id === phaseId);
          if (phaseIndex === -1) phaseIndex = 0;

          setCurrentPhaseIndex(phaseIndex);
          setExpandedPhases(prev => new Set([...prev, phaseId]));

          if (event.type === "phase_start") {
            jobPhaseStarted = true; // 실제로 백엔드가 응답했음 — 이제부터 취소 시 interrupt 허용
            finalizeStreamingLog();
            setPhases(prev => updatePhaseStatus(prev, phaseIndex, "in_progress"));
            addLogImmediate(phaseIndex, {
              id: String(event.id), type: "info",
              timestamp: new Date(event.ts), content: event.message || phaseId, metadata: {},
            }, 0);

          } else if (event.type === "phase_complete") {
            finalizeStreamingLog();
            setPhases(prev => completePhase(prev, phaseIndex));
            addLogImmediate(phaseIndex, {
              id: String(event.id), type: "tool_result",
              timestamp: new Date(event.ts), content: event.message || phaseId, metadata: {},
            }, 0);

          } else if (event.type === "error") {
            finalizeStreamingLog();
            setHasError(true);
            if (phaseIndex >= 0) setPhases(prev => updatePhaseStatus(prev, phaseIndex, "error"));
            addLogImmediate(Math.max(0, phaseIndex), {
              id: String(event.id), type: "error",
              timestamp: new Date(event.ts), content: event.message || "알 수 없는 오류", metadata: {},
            }, 0);

          } else if (event.type === "page_start" || event.type === "page_complete") {
            finalizeStreamingLog();
            addLogImmediate(phaseIndex, {
              id: String(event.id),
              type: event.type === "page_complete" ? "tool_result" : "info",
              timestamp: new Date(event.ts), content: event.message || "", metadata: {},
            }, 3);

          } else if (event.type === "agent_log") {
            const message = maskPrompt(event.message || "");
            const existing = streamingLogRef.current;
            if (existing && existing.phaseIndex === phaseIndex) {
              appendToLog(phaseIndex, existing.logId, message);
            } else {
              finalizeStreamingLog();
              const newLog: StreamLog = {
                id: String(event.id), type: "info",
                timestamp: new Date(event.ts), content: message, metadata: {},
              };
              addLogImmediate(phaseIndex, newLog, 2);
              streamingLogRef.current = { logId: String(event.id), phaseIndex };
            }

          } else if (event.type === "structure.preview") {
            // EDA: structure preview received — pause pipeline for user approval
            const data = event.data || {};
            setPendingStructure({
              wikiStructure: data.wiki_structure,
              pageCount: (data.page_count as number) ?? 0,
              sectionCount: (data.section_count as number) ?? 0,
              projectType: 'general' as any,
              actualFileCount: 0,
              file_tree: '',
              readme: '',
              subsystems: [],
            });
            setAwaitingApproval(true);

          } else if (event.type === "agent.chunk") {
            return; // always suppress streaming chunks — only show final response

          } else if (event.type === "agent.request") {
            if (process.env.NEXT_PUBLIC_DEBUG_PANEL !== 'true') return;
            finalizeStreamingLog();
            addLogImmediate(phaseIndex, {
              id: String(event.id ?? `req-${debugIdRef.current++}`), type: "agent.request",
              timestamp: new Date(event.ts), content: event.message || '', metadata: {},
            }, 3);
            return;

          } else if (event.type === "agent.response") {
            finalizeStreamingLog();
            const content = event.message || JSON.stringify(event.data || {});
            if (!content) return;
            addLogImmediate(phaseIndex, {
              id: String(event.id ?? `resp-${debugIdRef.current++}`), type: "agent.response",
              timestamp: new Date(event.ts), content, metadata: {},
            }, 5);
            return;
          } else {
            finalizeStreamingLog();
            const message = event.message || JSON.stringify(event.data || {});
            if (!message) return;
            addLogImmediate(phaseIndex, {
              id: String(event.id), type: "info",
              timestamp: new Date(event.ts), content: message, metadata: {},
            }, 5);
          }
        },
      });

      try {
        if (!isCancelled) {
          // ── Resume 브릿지: sessionStorage에 resume 데이터가 있으면 Phase 1-2 스킵 ──
          const resumeRaw = typeof window !== 'undefined'
            ? sessionStorage.getItem('localwiki_resume_pending') : null;
          if (resumeRaw) {
            sessionStorage.removeItem('localwiki_resume_pending');
            try {
              const rd = JSON.parse(resumeRaw);
              const ws = rd.wikiStructure || {};
              const sections: any[] = ws.sections || [];
              const allPages = sections.flatMap((s: any) => s.pages || []);
              const preBuilt: WikiStructureResult = {
                wikiStructure: ws,
                pageCount: allPages.length,
                sectionCount: sections.length,
                projectType: 'code' as any,
                actualFileCount: 0,
                file_tree: '',
                readme: '',
                subsystems: [],
              };
              await runWikiGeneration(
                projectPath, streamId, language, testMode,
                provider, model, apiKey, mode, cliTool,
                false, { mcp: mcpEnabled, concurrency: pageConcurrency, businessFlowOnly }, preBuilt,
                { skipPageIds: rd.completedPageIds ?? [], cachedPages: rd.generatedPages ?? {} },
                stopSignalRef.current,
              );
            } catch (resumeErr) {
              console.error('Resume execution failed, falling back to normal flow', resumeErr);
            }
            if (!isCancelled) {
              jobFinishedRef.current = true;
              setIsComplete(true);
              setTimeout(() => { if (!isCancelled) onComplete(); }, 1500);
            }
            return;
          }

          // ── Phase 1–2: ToC 생성 → approval 루프 ──────────────────────────
          let approvedStructure: WikiStructureResult | null = null;
          let prevStructure: WikiStructureResult | null = null;
          let feedbackForNext = '';
          const approvalStorageKey = `localwiki_pending_structure_${sanitizeRepoName(projectPath)}_${language}`;
          let restoredStructure: WikiStructureResult | null = null;
          try {
            const storedStructure = sessionStorage.getItem(approvalStorageKey);
            if (storedStructure) restoredStructure = JSON.parse(storedStructure) as WikiStructureResult;
          } catch {
            sessionStorage.removeItem(approvalStorageKey);
          }

          while (!approvedStructure && !isCancelled) {
            const result: WikiStructureResult = restoredStructure ?? await runWikiStructure(
                projectPath, streamId, language, testMode,
                provider, model, apiKey, mode, cliTool,
                { mcp: mcpEnabled, concurrency: pageConcurrency, businessFlowOnly },
                feedbackForNext || undefined,
                prevStructure?.wikiStructure,
              );
            restoredStructure = null;
            if (isCancelled) return;

            // structure.preview 이벤트가 onEvent를 통해 setPendingStructure를 이미 호출했지만
            // subsystems 등 추가 필드는 runWikiStructure 반환값으로만 확보 가능 — 여기서 보완
            setPendingStructure(result);
            setAwaitingApproval(true);
            sessionStorage.setItem(approvalStorageKey, JSON.stringify(result));

            const decision = await new Promise<ApprovalDecision>((resolve) => {
              approvalRef.current = resolve;
            });

            setAwaitingApproval(false);
            sessionStorage.removeItem(approvalStorageKey);
            if (decision.action === 'cancel') return;
            if (decision.action === 'regenerate') {
              feedbackForNext = decision.feedback;
              prevStructure = result;
              continue;
            }
            approvedStructure = result;
          }

          if (isCancelled || !approvedStructure) return;

          // ── Phase 2.5+: 승인된 구조로 나머지 파이프라인 실행 ─────────────
          await runWikiGeneration(projectPath, streamId, language, testMode, provider, model, apiKey, mode, cliTool, enableBusiness, { mcp: mcpEnabled, concurrency: pageConcurrency, businessFlowOnly }, approvedStructure, undefined, stopSignalRef.current);

          if (enableBusiness && !isCancelled) {
            addLogImmediate(0, {
              id: generateId(), type: "info", timestamp: new Date(),
              content: "💼 비즈니스 분석 실행 중 (Data Flow, Workflow, Impact)...", metadata: {},
            }, 0);

            try {
              const repoUrls = businessProjectPaths?.length ? businessProjectPaths : [projectPath];
              const bizRes = await fetch("/api/analyze_business", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  repo_url: projectPath, repo_urls: repoUrls, language, provider, model, mode,
                  cli_tool: cliTool, ...(apiKey ? { api_key: apiKey } : {}),
                }),
              });

              if (!bizRes.ok) throw new Error("API response not OK");
              const bizData = await bizRes.json();

              const repoName = sanitizeRepoName(projectPath);
              const cacheUrl = `/api/wiki_cache?owner=local&repo=${encodeURIComponent(repoName)}&repo_type=local&language=${encodeURIComponent(language)}&model=${encodeURIComponent(model)}`;
              let cacheData = await fetch(cacheUrl).then(r => r.ok ? r.json() : null);
              if (!cacheData) {
                cacheData = await fetch(
                  `/api/wiki_cache?owner=local&repo=${encodeURIComponent(repoName)}&repo_type=local&language=${encodeURIComponent(language)}`
                ).then(r => r.ok ? r.json() : null);
              }

              if (!cacheData) throw new Error("기존 위키 캐시를 찾지 못해 비즈니스 분석 페이지를 병합할 수 없습니다.");

              const BIZ_PAGE_IDS = ["__business_overview__", "__business_dataflow__", "__business_workflow__", "__business_impact__"];
              const isMultiRepo = Boolean(bizData.is_multi_repo);

              const bizSection = {
                id: "__section_business__",
                title: isMultiRepo ? "Cross-Repository Business Analysis" : (language !== "ko" ? "Business Analysis" : "비즈니스 분석"),
                pages: BIZ_PAGE_IDS,
              };
              if (!cacheData.wiki_structure.sections) cacheData.wiki_structure.sections = [];
              cacheData.wiki_structure.sections = [
                ...cacheData.wiki_structure.sections.filter((s: any) => s.id !== "__section_business__"),
                bizSection,
              ];
              if (!cacheData.wiki_structure.rootSections) cacheData.wiki_structure.rootSections = [];
              cacheData.wiki_structure.rootSections = [
                ...cacheData.wiki_structure.rootSections.filter((id: string) => id !== "__section_business__"),
                "__section_business__",
              ];

              const bizPages = [
                { id: "__business_overview__", title: isMultiRepo ? "Cross-Repository Business Overview" : "Business Overview", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_overview__ || "" },
                { id: "__business_dataflow__", title: isMultiRepo ? "Cross-Repository Data Flow" : "Data Flow", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_dataflow__ || "" },
                { id: "__business_workflow__", title: isMultiRepo ? "Cross-Repository Workflows" : "Workflows", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_workflow__ || "" },
                { id: "__business_impact__", title: isMultiRepo ? "Cross-Repository Impact Analysis" : "Impact Analysis", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_impact__ || "" },
              ];
              if (!cacheData.wiki_structure.pages) cacheData.wiki_structure.pages = [];
              cacheData.wiki_structure.pages = [
                ...cacheData.wiki_structure.pages.filter((p: any) => !BIZ_PAGE_IDS.includes(p.id)),
                ...bizPages,
              ];
              const newGeneratedPages = { ...cacheData.generated_pages };
              for (const p of bizPages) newGeneratedPages[p.id] = p;

              const saveRes = await fetch("/api/wiki_cache", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...cacheData, generated_pages: newGeneratedPages }),
              });
              if (!saveRes.ok) {
                const errText = await saveRes.text().catch(() => "");
                throw new Error(`비즈니스 분석 캐시 저장 실패: ${saveRes.status} ${errText}`);
              }

              addLogImmediate(0, {
                id: generateId(), type: "tool_result", timestamp: new Date(),
                content: bizData.warnings?.length
                  ? `✅ 비즈니스 분석 완료! (${bizData.warnings.length}개 경고)`
                  : "✅ 비즈니스 분석 완료!",
                metadata: {},
              }, 0);
            } catch (err: any) {
              addLogImmediate(0, {
                id: generateId(), type: "error", timestamp: new Date(),
                content: `⚠️ 비즈니스 분석 실패 (건너뜀): ${err.message}`, metadata: {},
              }, 0);
            }
          }
        }

        if (!isCancelled) {
          finalizeStreamingLog();
          jobFinishedRef.current = true;
          setIsComplete(true);
          setTimeout(() => { if (!isCancelled) onComplete(); }, 1500);
        }
      } catch (err) {
        console.error("Wiki generation error:", err);
        jobFinishedRef.current = true;
        setHasError(true);
      }

      return () => stream.close();
    };

    const cleanupPromise = loadDynamic();
    return () => {
      isCancelled = true;
      // phase_start를 수신한 적 있을 때만 interrupt — Strict Mode 이중 실행 방지
      if (jobPhaseStarted && !jobFinishedRef.current && activeStreamIdRef.current) {
        fetch('/api/wiki/interrupt-job', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: activeStreamIdRef.current, error: 'user_cancelled' }),
        }).catch(() => {});
      }
      cleanupPromise.then(cleanup => cleanup?.());
    };
  }, [projectPath, onComplete, runKey]); // runKey: re-trigger for in-place resume

  // Persist admin audit log when done
  useEffect(() => {
    if (!isComplete && !hasError) return;
    try {
      const raw = localStorage.getItem(ADMIN_LOGS_KEY) || "[]";
      let logs = JSON.parse(raw);
      if (!Array.isArray(logs)) logs = [];
      const currentId = projectName + "-" + (phases[0]?.logs[0]?.timestamp?.getTime() || Date.now());
      if (logs.some((l: any) => l._tempId === currentId)) return;
      logs.unshift({
        id: Date.now().toString(), _tempId: currentId,
        timestamp: new Date().toISOString(), projectName, projectPath,
        status: hasError ? "error" : "success", phases,
      });
      if (logs.length > 20) logs = logs.slice(0, 20);
      localStorage.setItem(ADMIN_LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error("Failed to save admin log", e);
    }
  }, [isComplete, hasError]);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  const clearDebugEvents = useCallback(() => setDebugEvents([]), []);

  const stop = useCallback(() => {
    stopSignalRef.current.stopped = true;
    if (!jobFinishedRef.current && activeStreamIdRef.current) {
      fetch('/api/wiki/interrupt-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: activeStreamIdRef.current, error: 'user_stop' }),
      }).catch(() => {});
      jobFinishedRef.current = true;
    }
    setIsStopped(true);
  }, []);

  const resume = useCallback(async () => {
    const parentJobId = activeStreamIdRef.current;
    if (!parentJobId) return;

    try {
      const rawName = projectPath.replace(/\/+$/, "").split("/").pop() || "project";
      const repo = rawName.replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_").replace(/_+/g, "_").replace(/^[_.\-]+|[_.\-]+$/g, "") || "project";

      const res = await fetch('/api/wiki/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: 'local', repo, repo_type: 'local', language, model, parent_job_id: parentJobId }),
      });
      if (res.ok) {
        const data = await res.json();
        sessionStorage.setItem('localwiki_resume_pending', JSON.stringify({
          wikiStructure: data.wiki_structure,
          completedPageIds: data.completed_page_ids,
          generatedPages: data.generated_pages,
        }));
      }
    } catch { /* resume without cached pages if API fails */ }

    // Reset state and re-trigger useEffect
    setPhases(ANALYSIS_PHASES.map((p) => ({ ...p, status: "pending", progress: 0, logs: [] })));
    setCurrentPhaseIndex(0);
    setIsComplete(false);
    setHasError(false);
    setIsStopped(false);
    setRunKey(k => k + 1);
  }, [projectPath, language, model]);

  return {
    phases,
    currentPhaseIndex,
    expandedPhases,
    isComplete,
    hasError,
    isStopped,
    stop,
    resume,
    togglePhase,
    totalProgress: calculateTotalProgress(phases),
    awaitingApproval,
    pendingStructure,
    onApproveStructure: () => approvalRef.current?.({ action: 'approve' }),
    onRegenerateStructure: (feedback: string) => approvalRef.current?.({ action: 'regenerate', feedback }),
    onCancelApproval: () => approvalRef.current?.({ action: 'cancel' }),
    debugEvents,
    clearDebugEvents,
    conversationItems,
  };
}
