"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bot, CheckCircle, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import { getTheme } from "@/lib/theme";
import { ANALYSIS_PHASES } from "@/lib/stream-types";
import { PhaseButton } from "./PhaseButton";
import { PhaseLogSection } from "./PhaseLogSection";
import { usePipelineState } from "./usePipelineState";
import { DebugEventPanel } from "./DebugEventPanel";

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
  } = usePipelineState(stateProps);

  const [feedbackText, setFeedbackText] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);

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
        {/* Phase nav (API mode only) */}
        {mode !== "cli" && (
          <aside style={{
            width: 280, borderRight: `1px solid ${t.divider}`,
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
        )}

        {/* Log stream */}
        <main ref={logContainerRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {process.env.NEXT_PUBLIC_DEBUG_PANEL === 'true' && (
            <DebugEventPanel events={debugEvents} onClear={clearDebugEvents} theme={t} />
          )}
          <AnimatePresence mode="popLayout">
            {phases.map((phase) =>
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
                    <div style={{ color: t.text, fontSize: 15, fontWeight: 600 }}>
                      📋 위키 구조 미리보기
                    </div>
                    <div style={{ color: t.textSecondary, fontSize: 13, marginTop: 2 }}>
                      {pendingStructure.sectionCount}개 섹션 · {pendingStructure.pageCount}개 페이지
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
        </main>
      </div>
    </motion.div>
  );
}
