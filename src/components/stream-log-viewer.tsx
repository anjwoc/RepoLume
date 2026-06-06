"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bot, ChevronDown, CheckCircle } from "lucide-react";
import { getTheme } from "@/lib/theme";
import {
  StreamLog, LogType, AnalysisPhase,
  ANALYSIS_PHASES, SIMULATION_CONVERSATIONS
} from "@/lib/stream-types";
import {
  getLogIcon, getLogColor, getLogLabel,
  formatTimestamp, Clock
} from "@/lib/log-utils";
import {
  getPhaseStatusIcon, calculateTotalProgress,
  updatePhaseStatus, addLogToPhase, completePhase,
  generateId
} from "@/lib/analysis-utils";

const ADMIN_LOGS_KEY = "localwiki_admin_logs";

interface StreamLogViewerProps {
  isDark: boolean;
  projectPath: string;
  businessProjectPaths?: string[];
  language: string;
  languages?: string[];   // 다국어 동시 생성 목록
  testMode: boolean;
  provider: string;
  model: string;
  apiKey?: string;
  mode?: "cli" | "api";
  cliTool?: string;
  enableBusiness?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}


/** 영업기밀 프롬프트 마스킹: AI에 전달되는 시스템 프롬프트 전문을 로그에서 숨깁니다 */
function maskPrompt(text: string): string {
  // 시스템 프롬프트 패턴 마스킹
  const PROMPT_PATTERNS = [
    /You are an expert technical writer[\s\S]{0,2000}?(?=\n\n|$)/gi,
    /Analyze this repository[\s\S]{0,3000}?(?=Output MUST be|$)/gi,
    /IMPORTANT:\s*The wiki content[\s\S]{0,500}?(?=\n|$)/gi,
    /### Mermaid Diagram Rules[\s\S]{0,500}?(?=\n\n|$)/gi,
    /### Naming Conventions[\s\S]{0,500}?(?=\n\n|$)/gi,
  ];
  let masked = text;
  for (const pattern of PROMPT_PATTERNS) {
    masked = masked.replace(pattern, '[SYSTEM PROMPT 감충]');
  }
  return masked;
}

export function StreamLogViewer({ isDark, projectPath, businessProjectPaths, language, languages, testMode, provider, model, apiKey, mode = "cli", cliTool, enableBusiness, onComplete, onCancel }: StreamLogViewerProps) {
  const t = getTheme(isDark);
  const [phases, setPhases] = useState<AnalysisPhase[]>(() =>
    ANALYSIS_PHASES.map((p) => ({
      ...p,
      status: "pending",
      progress: 0,
      logs: [],
    }))
  );
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(() =>
    new Set(mode === "cli" ? ANALYSIS_PHASES.map(p => p.id) : [ANALYSIS_PHASES[0].id])
  );
  const [isComplete, setIsComplete] = useState(false);
  const [hasError, setHasError] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const projectName = projectPath?.split("/").filter(Boolean).pop() || "my-project";

  const sanitizeRepoName = (path: string) => {
    const raw = path.replace(/\/+$/, "").replace(/\\/g, "/").split("/").pop() || "project";
    return raw
      .replace(/[^a-zA-Z0-9가-힣\-_.]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_.\-]+|[_.\-]+$/g, "")
      || "project";
  };

  // 스트리밍 로그 버퍼: agent_log 타입 연속 이벤트를 하나의 로그에 이어붙임
  // { logId, phaseIndex } 를 기억해뒀다가 같은 로그를 append
  const streamingLogRef = useRef<{ logId: string; phaseIndex: number } | null>(null);

  // 스트리밍 버퍼를 확정 종료 (새 경계 이벤트 전에 호출)
  const finalizeStreamingLog = () => {
    streamingLogRef.current = null;
  };

  // 특정 logId의 content에 텍스트를 append하는 state setter
  const appendToLog = (phaseIndex: number, logId: string, text: string) => {
    setPhases(prev => prev.map((phase, idx) => {
      if (idx !== phaseIndex) return phase;
      return {
        ...phase,
        logs: phase.logs.map(log =>
          log.id === logId
            ? { ...log, content: log.content + text }
            : log
        ),
      };
    }));
  };

  // 실제 데이터 생성 로직
  useEffect(() => {
    let isCancelled = false;
    const streamId = generateId();

    // 상태 업데이트 함수를 클로저 밖에서 직접 접근하기 위해 래퍼
    const addLogImmediate = (phaseIndex: number, log: StreamLog, max: number) => {
      setPhases(prev => addLogToPhase(prev, phaseIndex, log, max));
    };

    const loadDynamic = async () => {
      // 1. Subscribe to logs via EventSource
      const { createTaskStream } = await import('@/lib/taskStreamClient');
      const { runWikiGeneration, translateWikiGeneration } = await import('@/lib/wiki-generator');

      const stream = createTaskStream(streamId, {
        onEvent: (event: any) => {
          if (isCancelled || event.type === 'heartbeat') return;

          const phaseId = event.phase || 'generation';
          let phaseIndex = ANALYSIS_PHASES.findIndex(p => p.id === phaseId);
          if (phaseIndex === -1) phaseIndex = 0;

          setCurrentPhaseIndex(phaseIndex);
          setExpandedPhases(prev => new Set([...prev, phaseId]));

          // ── 경계 이벤트: 스트리밍 종료 후 새 로그 시작 ────────────────
          if (event.type === 'phase_start') {
            finalizeStreamingLog();
            setPhases(prev => updatePhaseStatus(prev, phaseIndex, "in_progress"));
            // phase_start 메시지 자체를 정보 로그로 추가
            const startLog: StreamLog = {
              id: String(event.id),
              type: 'info',
              timestamp: new Date(event.ts),
              content: event.message || phaseId,
              metadata: {},
            };
            addLogImmediate(phaseIndex, startLog, 0);

          } else if (event.type === 'phase_complete') {
            finalizeStreamingLog();
            setPhases(prev => completePhase(prev, phaseIndex));
            const completeLog: StreamLog = {
              id: String(event.id),
              type: 'tool_result',
              timestamp: new Date(event.ts),
              content: event.message || phaseId,
              metadata: {},
            };
            addLogImmediate(phaseIndex, completeLog, 0);

          } else if (event.type === 'error') {
            // 에러: 해당 phase를 error 상태로 + 에러 로그 추가
            finalizeStreamingLog();
            setHasError(true);
            if (phaseIndex >= 0) {
              setPhases(prev => updatePhaseStatus(prev, phaseIndex, "error"));
            }
            const errLog: StreamLog = {
              id: String(event.id),
              type: 'error',
              timestamp: new Date(event.ts),
              content: event.message || '알 수 없는 오류',
              metadata: {},
            };
            addLogImmediate(Math.max(0, phaseIndex), errLog, 0);

          } else if (event.type === 'page_start' || event.type === 'page_complete') {
            // 페이지 시작/완료도 경계 이벤트
            finalizeStreamingLog();
            const pageLog: StreamLog = {
              id: String(event.id),
              type: event.type === 'page_complete' ? 'tool_result' : 'info',
              timestamp: new Date(event.ts),
              content: event.message || '',
              metadata: {},
            };
            addLogImmediate(phaseIndex, pageLog, 3);

          } else if (event.type === 'agent_log') {
            // ── 스트리밍 텍스트: 마스킹 후 마지막 로그에 이어말기 ─────────────────
            const raw: string = event.message || '';
            const message = maskPrompt(raw);
            const existing = streamingLogRef.current;

            if (existing && existing.phaseIndex === phaseIndex) {
              // 같은 phase 안에서 이어지는 스트리밍 → append
              appendToLog(phaseIndex, existing.logId, message);
            } else {
              // 새 스트리밍 로그 시작
              finalizeStreamingLog();
              const newLog: StreamLog = {
                id: String(event.id),
                type: 'info',
                timestamp: new Date(event.ts),
                content: message,
                metadata: {},
              };
              addLogImmediate(phaseIndex, newLog, 2);
              streamingLogRef.current = { logId: String(event.id), phaseIndex };
            }

          } else {
            // 기타 일반 메시지 (task_status 등)
            finalizeStreamingLog();
            const message = event.message || JSON.stringify(event.data || {});
            if (!message) return;
            const newLog: StreamLog = {
              id: String(event.id),
              type: 'info',
              timestamp: new Date(event.ts),
              content: message,
              metadata: {},
            };
            addLogImmediate(phaseIndex, newLog, 5);
          }
          // event.type === 'complete' 처리는 여기서 제거 (runWikiGeneration 성공 후 처리)
        }
      });

      // 2. Trigger generation
      try {
        if (!isCancelled) {
          await runWikiGeneration(projectPath, streamId, language, testMode, provider, model, apiKey, mode, cliTool);

          if (enableBusiness && !isCancelled) {
            addLogImmediate(0, {
              id: generateId(),
              type: 'info',
              timestamp: new Date(),
              content: '💼 비즈니스 분석 실행 중 (Data Flow, Workflow, Impact)...',
              metadata: {}
            }, 0);

            try {
              const repoUrls = businessProjectPaths && businessProjectPaths.length > 0
                ? businessProjectPaths
                : [projectPath];
              const bizRes = await fetch('/api/analyze_business', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  repo_url: projectPath,
                  repo_urls: repoUrls,
                  language,
                  provider,
                  model,
                  mode,
                  cli_tool: cliTool,
                  ...(apiKey ? { api_key: apiKey } : {}),
                })
              });

              if (bizRes.ok) {
                const bizData = await bizRes.json();

                const repoName = sanitizeRepoName(projectPath);
                const cacheUrl = `/api/wiki_cache?owner=local&repo=${encodeURIComponent(repoName)}&repo_type=local&language=${encodeURIComponent(language)}&model=${encodeURIComponent(model)}`;
                let cacheRes = await fetch(cacheUrl);
                let cacheData = cacheRes.ok ? await cacheRes.json() : null;
                if (!cacheData) {
                  const fallbackRes = await fetch(`/api/wiki_cache?owner=local&repo=${encodeURIComponent(repoName)}&repo_type=local&language=${encodeURIComponent(language)}`);
                  cacheData = fallbackRes.ok ? await fallbackRes.json() : null;
                }

                if (cacheData) {
                  const businessPageIds = ["__business_overview__", "__business_dataflow__", "__business_workflow__", "__business_impact__"];
                  const isMultiRepo = Boolean(bizData.is_multi_repo);

                  const bizSection = {
                    id: "__section_business__",
                    title: isMultiRepo ? "Cross-Repository Business Analysis" : (language !== "ko" ? "Business Analysis" : "비즈니스 분석"),
                    pages: businessPageIds
                  };

                  if (!cacheData.wiki_structure.sections) cacheData.wiki_structure.sections = [];
                  cacheData.wiki_structure.sections = cacheData.wiki_structure.sections
                    .filter((section: any) => section.id !== "__section_business__");
                  cacheData.wiki_structure.sections.push(bizSection);
                  if (!cacheData.wiki_structure.rootSections) cacheData.wiki_structure.rootSections = [];
                  cacheData.wiki_structure.rootSections = [
                    ...cacheData.wiki_structure.rootSections.filter((id: string) => id !== "__section_business__"),
                    "__section_business__",
                  ];

                  const bizPages = [
                    { id: "__business_overview__", title: isMultiRepo ? "Cross-Repository Business Overview" : "Business Overview", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_overview__ || "" },
                    { id: "__business_dataflow__", title: isMultiRepo ? "Cross-Repository Data Flow" : "Data Flow", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_dataflow__ || "" },
                    { id: "__business_workflow__", title: isMultiRepo ? "Cross-Repository Workflows" : "Workflows", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_workflow__ || "" },
                    { id: "__business_impact__", title: isMultiRepo ? "Cross-Repository Impact Analysis" : "Impact Analysis", description: "", importance: "high", filePaths: [], relatedPages: [], content: bizData.pages.__business_impact__ || "" }
                  ];

                  if (!cacheData.wiki_structure.pages) cacheData.wiki_structure.pages = [];
                  cacheData.wiki_structure.pages = cacheData.wiki_structure.pages
                    .filter((page: any) => !businessPageIds.includes(page.id));
                  cacheData.wiki_structure.pages.push(...bizPages);

                  const newGeneratedPages = { ...cacheData.generated_pages };
                  for (const p of bizPages) {
                    newGeneratedPages[p.id] = p;
                  }

                  const saveBizRes = await fetch('/api/wiki_cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...cacheData, generated_pages: newGeneratedPages })
                  });
                  if (!saveBizRes.ok) {
                    const errText = await saveBizRes.text().catch(() => "");
                    throw new Error(`비즈니스 분석 캐시 저장 실패: ${saveBizRes.status} ${errText}`);
                  }

                  addLogImmediate(0, {
                    id: generateId(),
                    type: 'tool_result',
                    timestamp: new Date(),
                    content: bizData.warnings?.length
                      ? `✅ 비즈니스 분석 완료! (${bizData.warnings.length}개 경고)`
                      : '✅ 비즈니스 분석 완료!',
                    metadata: {}
                  }, 0);
                } else {
                  throw new Error("기존 위키 캐시를 찾지 못해 비즈니스 분석 페이지를 병합할 수 없습니다.");
                }
              } else {
                throw new Error("API response not OK");
              }
            } catch (err: any) {
              addLogImmediate(0, {
                id: generateId(),
                type: 'error',
                timestamp: new Date(),
                content: `⚠️ 비즈니스 분석 실패 (건너뜀): ${err.message}`,
                metadata: {}
              }, 0);
            }
          }
        }

        // 정상 종료 시에만 화면 전환
        if (!isCancelled) {
          finalizeStreamingLog();
          setIsComplete(true);
          setTimeout(() => {
            if (!isCancelled) onComplete();
          }, 1500);
        }
      } catch (err) {
        console.error("Wiki generation error:", err);
        setHasError(true);
      }

      return () => {
        stream.close();
      };
    };

    const cleanupPromise = loadDynamic();

    return () => {
      isCancelled = true;
      cleanupPromise.then(cleanup => cleanup && cleanup());
    };
  }, [projectPath, onComplete]);

  // 자동 스크롤
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [phases]);

  // 완료되거나 에러 발생 시 어드민 로그(작업 기록) 저장
  useEffect(() => {
    if (isComplete || hasError) {
      try {
        const raw = localStorage.getItem(ADMIN_LOGS_KEY) || "[]";
        let logs = JSON.parse(raw);
        if (!Array.isArray(logs)) logs = [];

        // 중복 저장 방지 (같은 데이터)
        const currentId = projectName + "-" + (phases[0]?.logs[0]?.timestamp?.getTime() || Date.now());
        if (logs.some((l: any) => l._tempId === currentId)) return;

        logs.unshift({
          id: Date.now().toString(),
          _tempId: currentId,
          timestamp: new Date().toISOString(),
          projectName,
          projectPath,
          status: hasError ? "error" : "success",
          phases: phases,
        });

        // 최대 20개만 유지 (용량 제한)
        if (logs.length > 20) logs = logs.slice(0, 20);

        localStorage.setItem(ADMIN_LOGS_KEY, JSON.stringify(logs));
      } catch (e) {
        console.error("Failed to save admin log", e);
      }
    }
  }, [isComplete, hasError]);


  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  const totalProgress = calculateTotalProgress(phases);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
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
      <header
        style={{
          padding: "20px 24px",
          borderBottom: `1px solid ${t.divider}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              background: "linear-gradient(145deg, #4096F7, #1A5FD4)",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(49,130,246,0.25)",
            }}
          >
            <Bot size={20} color="white" />
          </div>
          <div>
            <h1 style={{ color: t.text, fontSize: 16, fontWeight: 600, margin: 0 }}>
              프로젝트 분석 중
            </h1>
            <p style={{ color: t.textSecondary, fontSize: 13, margin: 0 }}>
              {projectName}
            </p>
          </div>
        </div>

        <button
          onClick={onCancel}
          style={{
            background: t.surface,
            border: "none",
            padding: "8px 16px",
            borderRadius: 10,
            color: t.textSecondary,
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = t.surfaceHover}
          onMouseLeave={(e) => e.currentTarget.style.background = t.surface}
        >
          취소
        </button>
      </header>

      {/* Progress Overview */}
      <div
        style={{
          padding: "16px 24px",
          background: t.surface,
          borderBottom: `1px solid ${t.divider}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ color: t.textSecondary, fontSize: 12, fontWeight: 500 }}>전체 진행률</span>
          <span style={{ color: t.text, fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {Math.round(totalProgress)}%
          </span>
        </div>
        <div style={{ height: 6, background: t.divider, borderRadius: 999, overflow: "hidden" }}>
          <motion.div
            animate={{ width: `${totalProgress}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            style={{
              height: "100%",
              background: isComplete ? t.success : `linear-gradient(90deg, ${t.primary}, #60A5FA)`,
              borderRadius: 999,
            }}
          />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Phase List (API Mode Only) */}
        {mode !== "cli" && (
          <aside
            style={{
              width: 280,
              borderRight: `1px solid ${t.divider}`,
              overflowY: "auto",
              padding: 16,
              flexShrink: 0,
            }}
          >
            <p style={{
              color: t.textMuted,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              margin: "0 0 12px 4px",
            }}>
              분석 단계
            </p>
            {phases.map((phase, index) => (
              <PhaseButton
                key={phase.id}
                phase={phase}
                isActive={index === currentPhaseIndex && !isComplete}
                isExpanded={expandedPhases.has(phase.id)}
                onToggle={() => togglePhase(phase.id)}
                theme={t}
              />
            ))}
          </aside>
        )}

        {/* Log Stream */}
        <main ref={logContainerRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          <AnimatePresence mode="popLayout">
            {phases.map((phase) =>
              expandedPhases.has(phase.id) && phase.logs.length > 0 && (
                <PhaseLogSection
                  key={phase.id}
                  phase={phase}
                  theme={t}
                />
              )
            )}
          </AnimatePresence>

          {/* Complete Message */}
          <AnimatePresence>
            {isComplete && !hasError && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "40px 20px",
                  background: t.successLight,
                  borderRadius: 16,
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    background: t.success,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <CheckCircle size={28} color="white" />
                </div>
                <h2 style={{ color: t.text, fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
                  분석이 완료되었어요!
                </h2>
                <p style={{ color: t.textSecondary, fontSize: 14, margin: 0 }}>
                  위키 뷰어로 이동합니다...
                </p>
              </motion.div>
            )}

            {hasError && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "40px 20px",
                  background: `${t.error}15`,
                  borderRadius: 16,
                  textAlign: "center",
                  marginTop: 20,
                }}
              >
                <h2 style={{ color: t.error, fontSize: 20, fontWeight: 600, margin: "0 0 8px" }}>
                  분석 중 오류가 발생했습니다.
                </h2>
                <p style={{ color: t.textSecondary, fontSize: 14, margin: 0 }}>
                  로그를 확인하고 다시 시도해주세요.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </motion.div>
  );
}

// Phase Button 컴포넌트
function PhaseButton({
  phase,
  isActive,
  isExpanded,
  onToggle,
  theme: t,
}: {
  phase: AnalysisPhase;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        padding: "10px 8px",
        borderRadius: 10,
        background: isActive ? t.primaryLight : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        marginBottom: 4,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = t.surfaceHover;
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "transparent";
      }}
    >
      <div style={{ paddingTop: 2 }}>
        {getPhaseStatusIcon(phase.status, t)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
          <span
            style={{
              color: phase.status === "completed" ? t.success : isActive ? t.primary : t.text,
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {phase.name}
          </span>
          {phase.logs.length > 0 && (
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} color={t.textMuted} />
            </motion.div>
          )}
        </div>
        <p style={{ color: t.textMuted, fontSize: 11, margin: 0, lineHeight: 1.4 }}>
          {phase.description}
        </p>
        {phase.status === "in_progress" && (
          <div style={{ marginTop: 8, height: 3, background: t.divider, borderRadius: 999, overflow: "hidden" }}>
            <motion.div
              animate={{ width: `${phase.progress}%` }}
              transition={{ duration: 0.3 }}
              style={{ height: "100%", background: t.primary, borderRadius: 999 }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

// Phase Log Section 컴포넌트
function PhaseLogSection({
  phase,
  theme: t,
}: {
  phase: AnalysisPhase;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      style={{ marginBottom: 24 }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        {getPhaseStatusIcon(phase.status, t)}
        <span style={{ color: t.text, fontSize: 14, fontWeight: 600 }}>{phase.name}</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          paddingLeft: 24,
          borderLeft: `2px solid ${t.divider}`,
        }}
      >
        <AnimatePresence mode="popLayout">
          {phase.logs.map((log) => (
            <LogEntry key={log.id} log={log} theme={t} />
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// Log Entry 컴포넌트
function LogEntry({
  log,
  theme: t,
}: {
  log: StreamLog;
  theme: ReturnType<typeof getTheme>;
}) {
  const colors = getLogColor(log.type, t);

  // JSON 여부 판단
  const isJson = (() => {
    const c = log.content.trim();
    if (!c.startsWith('{') && !c.startsWith('[')) return false;
    try { JSON.parse(c); return true; } catch { return false; }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, x: -10, height: 0 }}
      animate={{ opacity: 1, x: 0, height: "auto" }}
      transition={{ duration: 0.25 }}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {/* Log Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            background: colors.bg,
            borderRadius: 6,
            color: colors.text,
          }}
        >
          {getLogIcon(log.type)}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {getLogLabel(log.type)}
          </span>
        </div>
        {isJson && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: t.textMuted,
            background: t.surface,
            padding: "2px 7px",
            borderRadius: 5,
            letterSpacing: "0.03em",
          }}>
            JSON
          </span>
        )}
        <LogMetadata log={log} theme={t} />
      </div>

      {/* Log Content */}
      <div
        style={{
          background: isJson
            ? (t as any).codeBg ?? (t.surface)
            : t.surface,
          borderRadius: 10,
          padding: isJson ? "0" : "12px 16px",
          borderLeft: `3px solid ${colors.border}`,
          overflow: "hidden",
        }}
      >
        {isJson ? (
          <pre
            style={{
              color: t.text,
              fontSize: 12,
              fontFamily: "var(--font-mono), 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
              lineHeight: 1.6,
              margin: 0,
              padding: "12px 16px",
              whiteSpace: "pre",
              overflowX: "auto",
              letterSpacing: "0",
            }}
          >
            {log.content}
          </pre>
        ) : (
          <p
            style={{
              color: t.text,
              fontSize: 13,
              fontFamily: "var(--font-sans), -apple-system, BlinkMacSystemFont, sans-serif",
              lineHeight: 1.65,
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              letterSpacing: "-0.01em",
            }}
          >
            {log.content}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// Log Metadata 컴포넌트
function LogMetadata({
  log,
  theme: t,
}: {
  log: StreamLog;
  theme: ReturnType<typeof getTheme>;
}) {
  const metaStyle = {
    color: t.textMuted,
    fontSize: 10,
    fontFamily: "var(--font-mono), monospace",
    fontVariantNumeric: "tabular-nums" as const,
  };

  return (
    <>
      <span style={metaStyle}>{formatTimestamp(log.timestamp)}</span>
      {log.metadata?.model && (
        <span style={{ ...metaStyle, background: t.surface, padding: "2px 6px", borderRadius: 4 }}>
          {log.metadata.model}
        </span>
      )}
      {log.metadata?.duration && (
        <span style={{ ...metaStyle, display: "flex", alignItems: "center", gap: 3 }}>
          <Clock size={10} />
          {log.metadata.duration}ms
        </span>
      )}
      {log.metadata?.tokens && (
        <span style={metaStyle}>{log.metadata.tokens} tokens</span>
      )}
    </>
  );
}
