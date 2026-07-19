"use client";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bot, CheckCircle, ChevronDown, ChevronRight, Copy, Check, Activity, ListTree, ShieldCheck, Database, Search, ArrowUp, ArrowDown, Trash2, Play, Plus, SlidersHorizontal, X } from "lucide-react";
import { getTheme } from "@/lib/theme";
import { ANALYSIS_PHASES } from "@/lib/stream-types";
import { PhaseButton } from "./PhaseButton";
import { PhaseLogSection } from "./PhaseLogSection";
import { usePipelineState } from "./usePipelineState";
import { DebugEventPanel } from "./DebugEventPanel";
import { addQueuedRequest, moveQueuedRequest, removeQueuedRequest, type QueuedRequest } from "@/lib/request-queue";

const requestQueueKey = (projectPath: string) => `repolume_request_queue:${projectPath}`;

export interface PipelineViewerProps {
  isDark: boolean;
  projectPath: string;
  businessProjectPaths?: string[];
  language: string;
  languages?: string[];
  testMode: boolean;
  provider: string;
  model: string;
  apiKey?: string;
  mode?: "cli" | "api";
  cliTool?: string;
  enableBusiness?: boolean;
  pageConcurrency?: number;
  /** ⚗️ TEMP: 비즈니스 플로우 전용 테스트 모드 — 운영 배포 시 제거 */
  businessFlowOnly?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export function PipelineViewer({
  isDark,
  onCancel,
  ...stateProps
}: PipelineViewerProps) {
  const t = getTheme(isDark);
  const { mode = "cli" } = stateProps;

  const {
    phases,
    currentPhaseIndex,
    expandedPhases,
    isComplete,
    hasError,
    isStopped,
    stop,
    resume,
    togglePhase,
    totalProgress,
    awaitingApproval,
    pendingStructure,
    onApproveStructure,
    onRegenerateStructure,
    onCancelApproval,
    debugEvents,
    clearDebugEvents,
    conversationItems,
  } = usePipelineState(stateProps);

  const [feedbackText, setFeedbackText] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [queuedText, setQueuedText] = useState('');
  const [requestQueue, setRequestQueue] = useState<QueuedRequest[]>([]);
  const [queueReady, setQueueReady] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    setQueueReady(false);
    try {
      const parsed = JSON.parse(sessionStorage.getItem(requestQueueKey(stateProps.projectPath)) ?? '[]');
      setRequestQueue(Array.isArray(parsed) ? parsed : []);
    } catch {
      setRequestQueue([]);
    }
    setQueueReady(true);
  }, [stateProps.projectPath]);

  useEffect(() => {
    if (!queueReady) return;
    sessionStorage.setItem(requestQueueKey(stateProps.projectPath), JSON.stringify(requestQueue));
  }, [queueReady, requestQueue, stateProps.projectPath]);

  const filteredPhases = useMemo(() => {
    const query = logQuery.trim().toLocaleLowerCase();
    if (!query) return phases;
    return phases.map((phase) => ({
      ...phase,
      logs: phase.logs.filter((log) => `${log.type} ${log.content}`.toLocaleLowerCase().includes(query)),
    }));
  }, [logQuery, phases]);

  const queueRequest = () => {
    setRequestQueue((current) => addQueuedRequest(current, queuedText));
    if (queuedText.trim()) setQueuedText('');
  };

  const applyQueuedRequest = (request: QueuedRequest) => {
    if (!awaitingApproval) return;
    onRegenerateStructure(request.text);
    setRequestQueue((current) => removeQueuedRequest(current, request.id));
  };

  const copyTocAsMarkdown = useCallback(() => {
    if (!pendingStructure) return;
    const ws = pendingStructure.wikiStructure;
    const rootSections: string[] = ws?.rootSections ?? [];
    const sections: any[] = ws?.sections ?? [];
    const pages: any[] = ws?.pages ?? [];
    const pageById = Object.fromEntries(pages.map((p: any) => [p.id, p]));
    const sectionById = Object.fromEntries(sections.map((s: any) => [s.id, s]));
    const orderedSections = rootSections.length > 0
      ? rootSections.map((id: string) => sectionById[id]).filter(Boolean)
      : sections;

    const lines: string[] = [`# ${ws?.title ?? 'Wiki Structure'}`, ''];
    for (const section of orderedSections) {
      const sectionPages: any[] = (section.pages ?? []).map((pid: string) => pageById[pid]).filter(Boolean);
      lines.push(`## ${section.title}`);
      for (const page of sectionPages) {
        lines.push(`- ${page.title}`);
      }
      lines.push('');
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [pendingStructure]);

  // 새 구조가 도착하면 첫 5개 섹션 자동 펼침
  useEffect(() => {
    if (!pendingStructure) return;
    const sections: any[] = pendingStructure.wikiStructure?.sections ?? [];
    const rootSections: string[] = pendingStructure.wikiStructure?.rootSections ?? [];
    const initial = rootSections.slice(0, 5);
    setExpandedSections(new Set(initial.length > 0 ? initial : sections.slice(0, 5).map((s: any) => s.id)));
  }, [pendingStructure]);

  const projectName = stateProps.projectPath?.split("/").filter(Boolean).pop() || "my-project";

  const logContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [phases]);

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
      <header style={{
        padding: "20px 24px",
        borderBottom: `1px solid ${t.divider}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40,
            background: "linear-gradient(145deg, #4096F7, #1A5FD4)",
            borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 16px rgba(49,130,246,0.25)",
          }}>
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
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="pipeline-inspector-toggle" title="작업 인스펙터 열기" onClick={() => setInspectorOpen(true)} style={{ background: t.surface, border: "none", padding: "8px 10px", borderRadius: 10, color: t.textSecondary, cursor: "pointer" }}><SlidersHorizontal size={15} /></button>
          {!isComplete && !hasError && !isStopped && (
            <button
              onClick={stop}
              style={{
                background: "transparent", border: `1px solid ${t.divider}`, padding: "8px 16px",
                borderRadius: 10, color: t.textSecondary, fontSize: 13,
                cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.surface; e.currentTarget.style.color = t.text; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.textSecondary; }}
            >
              중지
            </button>
          )}
          <button
            onClick={onCancel}
            style={{
              background: t.surface, border: "none", padding: "8px 16px",
              borderRadius: 10, color: t.textSecondary, fontSize: 13,
              cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = t.surfaceHover}
            onMouseLeave={(e) => e.currentTarget.style.background = t.surface}
          >
            취소
          </button>
        </div>
      </header>

      {/* Progress bar */}
      <div style={{
        padding: "16px 24px", background: t.surface,
        borderBottom: `1px solid ${t.divider}`, flexShrink: 0,
      }}>
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

      {/* Stopped state banner */}
      <AnimatePresence>
        {isStopped && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{
              padding: "16px 24px", background: isDark ? "#1c1c1e" : "#fafafa",
              borderBottom: `1px solid ${t.divider}`, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}
          >
            <span style={{ color: t.textSecondary, fontSize: 13 }}>
              ⏸ 생성이 중지되었습니다. {Math.round(totalProgress)}% 완료된 상태입니다.
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={resume}
                style={{
                  background: t.primary, border: "none", padding: "8px 16px",
                  borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "0.85"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
              >
                이어서 생성
              </button>
              <button
                onClick={onCancel}
                style={{
                  background: t.surface, border: "none", padding: "8px 16px",
                  borderRadius: 10, color: t.textSecondary, fontSize: 13,
                  cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = t.surfaceHover}
                onMouseLeave={(e) => e.currentTarget.style.background = t.surface}
              >
                처음부터
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <aside className="pipeline-phase-rail" style={{
            width: 240, borderRight: `1px solid ${t.divider}`,
            overflowY: "auto", padding: 16, flexShrink: 0,
          }}>
            <p style={{
              color: t.textMuted, fontSize: 11, fontWeight: 600,
              letterSpacing: "0.5px", textTransform: "uppercase", margin: "0 0 12px 4px",
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

        {/* Log stream */}
        <main ref={logContainerRef} className="pipeline-conversation-pane" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "24px clamp(20px, 4vw, 48px)", background: isDark ? t.bg : "#fbfcfe" }}>
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
          {process.env.NEXT_PUBLIC_DEBUG_PANEL === 'true' && (
            <DebugEventPanel events={debugEvents} onClear={clearDebugEvents} theme={t} />
          )}
          <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
            {conversationItems.map((item) => {
              const accent = item.kind === "error" ? t.error : item.kind === "warning" ? "#d97706" : item.kind === "complete" ? t.success : t.primary;
              return (
                <div id={`conversation-${item.eventId}`} key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", border: `1px solid ${t.divider}`, borderRadius: 11, background: t.surface }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: `${accent}18`, color: accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{item.kind === "approval" ? <ListTree size={13} /> : item.kind === "complete" ? <CheckCircle size={13} /> : <Activity size={13} />}</div>
                  <div style={{ minWidth: 0, flex: 1 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><span style={{ color: t.text, fontSize: 11, fontWeight: 650 }}>{item.title}</span><span style={{ color: t.textMuted, fontSize: 9, fontVariantNumeric: "tabular-nums" }}>{new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span></div><div style={{ color: t.textSecondary, fontSize: 11, lineHeight: 1.5, marginTop: 3, overflowWrap: "anywhere" }}>{item.message || item.phase}</div></div>
                </div>
              );
            })}
          </div>
          <AnimatePresence mode="popLayout">
            {filteredPhases.map((phase) =>
              expandedPhases.has(phase.id) && phase.logs.length > 0 && (
                <PhaseLogSection key={phase.id} phase={phase} theme={t} />
              )
            )}
          </AnimatePresence>

          {/* ToC Approval Panel */}
          <AnimatePresence>
            {awaitingApproval && pendingStructure && (
              <motion.div
                key="toc-approval"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3 }}
                style={{
                  marginTop: 20,
                  border: `1px solid ${t.divider}`,
                  borderRadius: 16,
                  overflow: "hidden",
                  background: t.surface,
                }}
              >
                {/* Panel header */}
                <div style={{
                  padding: "16px 20px",
                  background: isDark ? "rgba(64,150,247,0.08)" : "rgba(49,130,246,0.06)",
                  borderBottom: `1px solid ${t.divider}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ color: t.text, fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                      <ListTree size={16} color={t.primary} /> 위키 구조 미리보기
                    </div>
                  <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 2 }}>
                    {pendingStructure.sectionCount}개 섹션 · {pendingStructure.pageCount}개 페이지
                  </div>
                  <div style={{ color: t.textMuted, fontSize: 11, marginTop: 5 }}>
                    예상 생성 호출 {pendingStructure.pageCount}회 이상 · 앱 전용 artifacts에 저장
                  </div>
                  </div>
                  <button
                    onClick={copyTocAsMarkdown}
                    title="Markdown으로 복사"
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: copied
                        ? (isDark ? "rgba(52,199,89,0.15)" : "rgba(52,199,89,0.1)")
                        : t.surface,
                      border: `1px solid ${copied ? "#34C759" : t.divider}`,
                      borderRadius: 8, padding: "6px 12px",
                      color: copied ? "#34C759" : t.textSecondary,
                      fontSize: 12, fontWeight: 500, cursor: "pointer",
                      fontFamily: "inherit", transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => { if (!copied) e.currentTarget.style.background = t.surfaceHover; }}
                    onMouseLeave={(e) => { if (!copied) e.currentTarget.style.background = t.surface; }}
                  >
                    {copied
                      ? <><Check size={13} /><span>복사됨</span></>
                      : <><Copy size={13} /><span>MD 복사</span></>
                    }
                  </button>
                </div>

                {/* Section tree */}
                <div style={{ maxHeight: 360, overflowY: "auto", padding: "12px 0" }}>
                  {(() => {
                    const ws = pendingStructure.wikiStructure;
                    const rootSections: string[] = ws?.rootSections ?? [];
                    const sections: any[] = ws?.sections ?? [];
                    const pages: any[] = ws?.pages ?? [];
                    const pageById = Object.fromEntries(pages.map((p: any) => [p.id, p]));
                    const sectionById = Object.fromEntries(sections.map((s: any) => [s.id, s]));

                    const orderedSections = rootSections.length > 0
                      ? rootSections.map((id: string) => sectionById[id]).filter(Boolean)
                      : sections;

                    return orderedSections.map((section: any) => {
                      const isExpanded = expandedSections.has(section.id);
                      const sectionPages: any[] = (section.pages ?? []).map((pid: string) => pageById[pid]).filter(Boolean);
                      return (
                        <div key={section.id} style={{ marginBottom: 2 }}>
                          <button
                            onClick={() => setExpandedSections(prev => {
                              const next = new Set(prev);
                              if (next.has(section.id)) next.delete(section.id);
                              else next.add(section.id);
                              return next;
                            })}
                            style={{
                              display: "flex", alignItems: "center", gap: 6,
                              width: "100%", padding: "6px 20px",
                              background: "transparent", border: "none",
                              cursor: "pointer", textAlign: "left",
                              color: t.text, fontSize: 13, fontWeight: 600,
                              fontFamily: "inherit",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            {isExpanded
                              ? <ChevronDown size={14} color={t.textMuted} />
                              : <ChevronRight size={14} color={t.textMuted} />
                            }
                            {section.title}
                            <span style={{ color: t.textMuted, fontSize: 11, fontWeight: 400, marginLeft: 4 }}>
                              ({sectionPages.length})
                            </span>
                          </button>
                          {isExpanded && (
                            <div style={{ paddingLeft: 40 }}>
                              {sectionPages.map((page: any) => (
                                <div key={page.id} style={{
                                  padding: "4px 20px 4px 0",
                                  color: t.textSecondary, fontSize: 12,
                                }}>
                                  • {page.title}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Feedback textarea */}
                <div style={{ padding: "12px 20px", borderTop: `1px solid ${t.divider}` }}>
                  <label style={{ color: t.textSecondary, fontSize: 12, fontWeight: 500, display: "block", marginBottom: 6 }}>
                    구조에 대한 피드백 (선택사항)
                  </label>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder={"예: Terminal 섹션을 별도 페이지로 분리해주세요"}
                    rows={3}
                    style={{
                      width: "100%", boxSizing: "border-box",
                      background: t.bg, border: `1px solid ${t.divider}`,
                      borderRadius: 8, padding: "10px 12px",
                      color: t.text, fontSize: 13, fontFamily: "inherit",
                      resize: "vertical", outline: "none",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = t.primary)}
                    onBlur={(e) => (e.currentTarget.style.borderColor = t.divider)}
                  />
                </div>

                {/* Action buttons */}
                <div style={{
                  padding: "12px 20px 16px",
                  display: "flex", gap: 10, flexWrap: "wrap",
                }}>
                  <button
                    onClick={() => { onApproveStructure(); }}
                    style={{
                      background: t.primary, color: "white", border: "none",
                      padding: "10px 20px", borderRadius: 10, fontSize: 14,
                      fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                  >
                    이 구조로 생성 시작
                  </button>
                  <button
                    onClick={() => {
                      const fb = feedbackText.trim();
                      onRegenerateStructure(fb);
                      setFeedbackText('');
                    }}
                    style={{
                      background: t.surface, color: t.text,
                      border: `1px solid ${t.divider}`,
                      padding: "10px 20px", borderRadius: 10, fontSize: 14,
                      fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = t.surface)}
                  >
                    피드백 반영해서 재생성
                  </button>
                  <button
                    onClick={onCancelApproval}
                    style={{
                      background: "transparent", color: t.textSecondary, border: "none",
                      padding: "10px 16px", borderRadius: 10, fontSize: 14,
                      cursor: "pointer", fontFamily: "inherit",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = t.text)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = t.textSecondary)}
                  >
                    취소
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isComplete && !hasError && (
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "40px 20px", background: t.successLight,
                  borderRadius: 16, textAlign: "center",
                }}
              >
                <div style={{
                  width: 56, height: 56, background: t.success, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16,
                }}>
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
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                style={{
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "40px 20px", background: `${t.error}15`,
                  borderRadius: 16, textAlign: "center", marginTop: 20,
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
          </div>
        </main>
        <aside className={`pipeline-inspector${inspectorOpen ? ' is-open' : ''}`} style={{ width: 270, borderLeft: `1px solid ${t.divider}`, padding: 16, overflowY: "auto", flexShrink: 0, background: t.bg }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}><div style={{ color: t.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase" }}>작업 인스펙터</div><button type="button" className="pipeline-inspector-close" title="작업 인스펙터 닫기" onClick={() => setInspectorOpen(false)} style={{ border: 0, background: "transparent", color: t.textMuted, padding: 3, cursor: "pointer" }}><X size={14} /></button></div>
          <div style={{ display: "grid", gap: 9 }}>
            <div style={{ padding: 11, borderRadius: 10, border: `1px solid ${t.divider}`, background: t.surface }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: t.textSecondary }}><Activity size={13} color={t.primary} /> 진행 단계</div><div style={{ marginTop: 7, fontSize: 18, fontWeight: 700 }}>{phases.filter((phase) => phase.status === "completed").length}<span style={{ color: t.textMuted, fontSize: 11, fontWeight: 500 }}> / {phases.length}</span></div></div>
            <div style={{ padding: 11, borderRadius: 10, border: `1px solid ${t.divider}`, background: t.surface }}><div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: t.textSecondary }}><Database size={13} color={t.primary} /> 이벤트 로그</div><div style={{ marginTop: 7, fontSize: 18, fontWeight: 700 }}>{phases.reduce((sum, phase) => sum + phase.logs.length, 0)}<span style={{ color: t.textMuted, fontSize: 11, fontWeight: 500 }}> records</span></div></div>
          </div>
          <div style={{ marginTop: 18, borderTop: `1px solid ${t.divider}`, paddingTop: 15 }}><div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 10 }}>실행 설정</div><div style={{ display: "grid", gap: 8, fontSize: 11 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ color: t.textMuted }}>Provider</span><span style={{ color: t.text, fontWeight: 600 }}>{stateProps.provider}</span></div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ color: t.textMuted }}>Model</span><span style={{ color: t.text, fontWeight: 600, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stateProps.model}</span></div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ color: t.textMuted }}>Mode</span><span style={{ color: t.text, fontWeight: 600 }}>{mode.toUpperCase()}</span></div><div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ color: t.textMuted }}>Language</span><span style={{ color: t.text, fontWeight: 600 }}>{stateProps.language.toUpperCase()}</span></div></div></div>
          <div style={{ marginTop: 18, borderTop: `1px solid ${t.divider}`, paddingTop: 15 }}><div style={{ display: "flex", alignItems: "center", gap: 7, color: t.text, fontSize: 11, fontWeight: 650, marginBottom: 7 }}><ShieldCheck size={14} color="#16a34a" /> 무결성 규칙</div><p style={{ margin: 0, color: t.textMuted, fontSize: 10, lineHeight: 1.6 }}>빈 응답과 누락된 페이지는 완료로 처리하지 않습니다. 목차 승인과 모든 예상 산출물의 종료 상태가 확인된 뒤에만 완료됩니다.</p></div>
          <div style={{ marginTop: 18, borderTop: `1px solid ${t.divider}`, paddingTop: 15 }}>
            <label htmlFor="pipeline-log-search" style={{ display: "flex", alignItems: "center", gap: 7, color: t.text, fontSize: 11, fontWeight: 650, marginBottom: 8 }}><Search size={13} color={t.primary} /> 로그 검색</label>
            <input id="pipeline-log-search" value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="유형 또는 내용" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${t.divider}`, borderRadius: 8, padding: "8px 9px", background: t.surface, color: t.text, fontSize: 11, outline: "none" }} />
            {logQuery && <div style={{ marginTop: 6, color: t.textMuted, fontSize: 9 }}>{filteredPhases.reduce((sum, phase) => sum + phase.logs.length, 0)}개 일치</div>}
          </div>
          <div style={{ marginTop: 18, borderTop: `1px solid ${t.divider}`, paddingTop: 15 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}><span style={{ color: t.text, fontSize: 11, fontWeight: 650 }}>후속 요청 큐</span><span style={{ color: t.textMuted, fontSize: 9 }}>{requestQueue.length}개 대기</span></div>
            <div style={{ display: "flex", gap: 5 }}><input aria-label="후속 요청" value={queuedText} onChange={(event) => setQueuedText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') queueRequest(); }} placeholder="예: API 섹션을 분리" style={{ minWidth: 0, flex: 1, border: `1px solid ${t.divider}`, borderRadius: 8, padding: "8px 9px", background: t.surface, color: t.text, fontSize: 10, outline: "none" }} /><button type="button" title="큐에 추가" onClick={queueRequest} style={{ border: 0, borderRadius: 8, width: 31, background: t.primary, color: "white", cursor: "pointer" }}><Plus size={13} /></button></div>
            {requestQueue.length > 0 && <div style={{ display: "grid", gap: 6, marginTop: 9 }}>{requestQueue.map((request, index) => <div key={request.id} style={{ padding: 8, borderRadius: 8, border: `1px solid ${t.divider}`, background: t.surface }}><div style={{ color: t.textSecondary, fontSize: 10, lineHeight: 1.45, overflowWrap: "anywhere" }}>{request.text}</div><div style={{ display: "flex", gap: 3, marginTop: 6 }}><button type="button" title="위로 이동" disabled={index === 0} onClick={() => setRequestQueue((current) => moveQueuedRequest(current, request.id, -1))} style={{ border: 0, borderRadius: 5, padding: 4, color: t.textMuted, background: "transparent", cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? .35 : 1 }}><ArrowUp size={11} /></button><button type="button" title="아래로 이동" disabled={index === requestQueue.length - 1} onClick={() => setRequestQueue((current) => moveQueuedRequest(current, request.id, 1))} style={{ border: 0, borderRadius: 5, padding: 4, color: t.textMuted, background: "transparent", cursor: index === requestQueue.length - 1 ? "default" : "pointer", opacity: index === requestQueue.length - 1 ? .35 : 1 }}><ArrowDown size={11} /></button><button type="button" title={awaitingApproval ? "즉시 반영" : "목차 승인 대기 중에 반영할 수 있습니다"} disabled={!awaitingApproval} onClick={() => applyQueuedRequest(request)} style={{ border: 0, borderRadius: 5, padding: 4, color: awaitingApproval ? t.primary : t.textMuted, background: "transparent", cursor: awaitingApproval ? "pointer" : "default", opacity: awaitingApproval ? 1 : .4 }}><Play size={11} /></button><button type="button" title="요청 삭제" onClick={() => setRequestQueue((current) => removeQueuedRequest(current, request.id))} style={{ marginLeft: "auto", border: 0, borderRadius: 5, padding: 4, color: t.error, background: "transparent", cursor: "pointer" }}><Trash2 size={11} /></button></div></div>)}</div>}
          </div>
          {conversationItems.length > 0 && <div style={{ marginTop: 18, borderTop: `1px solid ${t.divider}`, paddingTop: 15 }}><div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 9 }}>대화 미니맵</div><div style={{ display: "grid", gap: 4 }}>{conversationItems.filter((item) => item.kind !== "progress" || item.eventId === conversationItems.at(-1)?.eventId).map((item) => <button key={item.id} onClick={() => document.getElementById(`conversation-${item.eventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} style={{ border: 0, borderRadius: 7, background: "transparent", color: t.textSecondary, padding: "6px 7px", fontSize: 10, textAlign: "left", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</button>)}</div></div>}
        </aside>
      </div>
    </motion.div>
  );
}
