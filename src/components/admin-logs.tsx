"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Clock, FileText, CheckCircle, AlertCircle, ChevronDown, Bot, Trash2 } from "lucide-react";
import { getTheme } from "@/lib/theme";
import type { AnalysisPhase, StreamLog } from "@/lib/stream-types";
import { getLogIcon, getLogColor, getLogLabel, formatTimestamp } from "@/lib/log-utils";
import { getPhaseStatusIcon, calculateTotalProgress } from "@/lib/analysis-utils";

interface AdminLogEntry {
  id: string;
  _tempId?: string;
  timestamp: string;
  projectName: string;
  projectPath: string;
  status: "success" | "error";
  phases: AnalysisPhase[];
}

interface AdminLogsScreenProps {
  isDark: boolean;
  onBack: () => void;
}

const ADMIN_LOGS_KEY = "localwiki_admin_logs";

export function AdminLogsScreen({ isDark, onBack }: AdminLogsScreenProps) {
  const t = getTheme(isDark);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADMIN_LOGS_KEY);
      if (raw) {
        setLogs(JSON.parse(raw));
      }
    } catch (e) {
      console.error("Failed to load admin logs", e);
    }
  }, []);

  const handleClearLogs = () => {
    if (confirm("모든 작업 기록을 삭제하시겠습니까?")) {
      localStorage.removeItem(ADMIN_LOGS_KEY);
      setLogs([]);
      setSelectedLogId(null);
    }
  };

  const selectedLog = logs.find(l => l.id === selectedLogId);

  return (
    <div className="flex w-full h-screen overflow-hidden" style={{ background: t.bg, color: t.text }}>
      {/* Left Sidebar - Log List */}
      <div 
        className="w-1/3 min-w-[300px] max-w-[400px] h-full flex flex-col border-r"
        style={{ borderColor: t.divider, background: t.surface }}
      >
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: t.divider }}>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-lg transition-colors hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: t.text }}
              title="홈으로 돌아가기"
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="font-bold text-lg font-serif">작업 기록 (Admin)</h2>
          </div>
          <button
            onClick={handleClearLogs}
            className="p-2 rounded-lg transition-colors hover:bg-red-500/10 text-red-500"
            title="모든 기록 지우기"
          >
            <Trash2 size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {logs.length === 0 ? (
            <div className="text-center py-10" style={{ color: t.textMuted }}>
              <FileText size={48} className="mx-auto mb-4 opacity-20" />
              <p>저장된 작업 기록이 없습니다.</p>
            </div>
          ) : (
            logs.map(log => {
              const isSelected = log.id === selectedLogId;
              const date = new Date(log.timestamp);
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  className="p-4 rounded-xl cursor-pointer transition-all duration-200 border"
                  style={{
                    background: isSelected ? t.surface : 'transparent',
                    borderColor: isSelected ? t.primary : t.divider,
                    boxShadow: isSelected ? `0 4px 12px ${t.shadow}` : 'none'
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold" style={{ color: t.text }}>{log.projectName}</div>
                    {log.status === 'success' ? (
                      <CheckCircle size={16} color={t.success} />
                    ) : (
                      <AlertCircle size={16} color={t.error} />
                    )}
                  </div>
                  <div className="text-xs truncate mb-2" style={{ color: t.textMuted }}>
                    {log.projectPath}
                  </div>
                  <div className="text-xs flex items-center gap-1" style={{ color: t.textMuted }}>
                    <Clock size={12} />
                    {date.toLocaleDateString()} {date.toLocaleTimeString()}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Content - ReadOnly Viewer */}
      <div className="flex-1 min-w-0 h-full overflow-hidden bg-dot-pattern relative flex flex-col">
        {!selectedLog ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center opacity-50" style={{ color: t.textMuted }}>
            <FileText size={64} className="mb-4 opacity-20" />
            <p className="font-serif text-lg">왼쪽에서 로그를 선택해주세요</p>
          </div>
        ) : (
          <ReadOnlyLogViewer phases={selectedLog.phases} theme={t} />
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// 이하 StreamLogViewer의 렌더링 로직 재사용 (읽기 전용 컴포넌트)
// -------------------------------------------------------------
function ReadOnlyLogViewer({ phases, theme: t }: { phases: AnalysisPhase[], theme: any }) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(phases.map(p => p.id)));

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden relative">
      {/* Scrollable Container */}
      <div className="flex-1 overflow-y-auto w-full">
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 p-4 md:p-10 pb-20">
          
          {/* Header */}
          <div 
            className="flex flex-col md:flex-row md:items-center justify-between p-6 rounded-2xl shadow-sm border relative overflow-hidden backdrop-blur-md"
            style={{ background: t.surface, borderColor: t.divider }}
          >
            <div className="flex items-center gap-4 relative z-10">
              <div 
                className="w-12 h-12 flex items-center justify-center rounded-full shadow-inner"
                style={{ background: t.bg, color: t.primary, border: `1px solid ${t.divider}` }}
              >
                <Bot size={24} />
              </div>
              <div>
                <h2 className="text-xl font-bold tracking-tight font-serif" style={{ color: t.text }}>과거 파이프라인 기록</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-medium" style={{ color: t.textSecondary }}>작업 뷰어 (읽기 전용)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Phase Timeline & Logs */}
          <div className="flex flex-col gap-4">
            <AnimatePresence>
            {phases.map((phase, index) => {
              const isExpanded = expandedPhases.has(phase.id);
              
              return (
                <motion.div
                  key={phase.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border shadow-sm overflow-hidden"
                  style={{ background: t.surface, borderColor: t.divider }}
                >
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                    onClick={() => togglePhase(phase.id)}
                  >
                    <div className="flex items-center gap-4">
                      {getPhaseStatusIcon(phase.status, t)}
                      <div>
                        <div className="font-semibold text-[15px] flex items-center gap-2" style={{ color: t.text }}>
                          {phase.name}
                          <span className="text-[11px] px-2 py-0.5 rounded-full font-mono" style={{ background: t.bg, color: t.textMuted }}>
                            Step {index + 1}/{phases.length}
                          </span>
                        </div>
                        <div className="text-[13px] mt-0.5" style={{ color: t.textMuted }}>
                          {phase.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                        <ChevronDown size={18} color={t.textMuted} />
                      </motion.div>
                    </div>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t"
                        style={{ borderColor: t.divider, background: t.bg }}
                      >
                        <div className="p-4 md:p-6 flex flex-col gap-6">
                          {phase.logs.length === 0 ? (
                            <div className="text-[13px] text-center italic py-4" style={{ color: t.textMuted }}>
                              기록된 로그가 없습니다.
                            </div>
                          ) : (
                            phase.logs.map((log) => (
                              <ReadOnlyLogEntry key={log.id} log={log} theme={t} />
                            ))
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------------
function ReadOnlyLogEntry({ log, theme: t }: { log: StreamLog, theme: any }) {
  const colors = getLogColor(log.type, t);
  const isJson = (() => {
    const c = log.content.trim();
    if (!c.startsWith('{') && !c.startsWith('[')) return false;
    try { JSON.parse(c); return true; } catch { return false; }
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: colors.bg, borderRadius: 6, color: colors.text }}>
          {getLogIcon(log.type)}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {getLogLabel(log.type)}
          </span>
        </div>
        {isJson && (
          <span style={{ fontSize: 10, fontWeight: 600, color: t.textMuted, background: t.surface, padding: "2px 7px", borderRadius: 5 }}>
            JSON
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: t.textMuted }}>
          <Clock size={11} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}>
            {formatTimestamp(new Date(log.timestamp))}
          </span>
        </div>
      </div>
      <div style={{ background: isJson ? t.codeBg ?? t.surface : t.surface, borderRadius: 10, padding: isJson ? "0" : "12px 16px", borderLeft: `3px solid ${colors.border}`, overflow: "hidden" }}>
        {isJson ? (
          <pre style={{ color: t.text, fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.6, margin: 0, padding: "12px 16px", whiteSpace: "pre-wrap", overflowX: "auto" }}>
            {log.content}
          </pre>
        ) : (
          <p style={{ color: t.text, fontSize: 13, lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {log.content}
          </p>
        )}
      </div>
    </div>
  );
}
