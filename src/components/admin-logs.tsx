"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowLeft, Clock, FileText, CheckCircle, AlertCircle,
  ChevronDown, Bot, Trash2, Database, RefreshCw, Loader2,
} from "lucide-react";
import { getTheme } from "@/lib/theme";
import type { AnalysisPhase, StreamLog } from "@/lib/stream-types";
import { getLogIcon, getLogColor, getLogLabel, formatTimestamp } from "@/lib/log-utils";
import { getPhaseStatusIcon } from "@/lib/analysis-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminLogEntry {
  id: string;
  _tempId?: string;
  timestamp: string;
  projectName: string;
  projectPath: string;
  status: "success" | "error";
  phases: AnalysisPhase[];
}

interface DbJob {
  id: string;
  project_id: string | null;
  status: "pending" | "running" | "completed" | "failed";
  current_phase: string | null;
  page_total: number;
  page_done: number;
  page_failed: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error: string | null;
}

interface DbEvent {
  id: number;
  job_id: string;
  seq: number;
  type: string;
  phase: string | null;
  message: string;
  data: Record<string, unknown>;
  ts: string;
}

interface AdminLogsScreenProps {
  isDark: boolean;
  onBack: () => void;
}

const ADMIN_LOGS_KEY = "localwiki_admin_logs";

// ── Main Screen ───────────────────────────────────────────────────────────────

export function AdminLogsScreen({ isDark, onBack }: AdminLogsScreenProps) {
  const t = getTheme(isDark);
  const [activeTab, setActiveTab] = useState<"local" | "db">("db");

  return (
    <div className="flex w-full h-screen overflow-hidden" style={{ background: t.bg, color: t.text }}>
      {activeTab === "local" ? (
        <LocalLogsPanel isDark={isDark} onBack={onBack} t={t} onSwitchTab={setActiveTab} />
      ) : (
        <DbJobsPanel isDark={isDark} onBack={onBack} t={t} onSwitchTab={setActiveTab} />
      )}
    </div>
  );
}

// ── Tab Switcher ──────────────────────────────────────────────────────────────

function TabSwitcher({
  active, onChange, t,
}: {
  active: "local" | "db";
  onChange: (v: "local" | "db") => void;
  t: ReturnType<typeof getTheme>;
}) {
  return (
    <div className="flex gap-1 p-1 rounded-lg" style={{ background: t.bg }}>
      {(["db", "local"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
          style={{
            background: active === tab ? t.surface : "transparent",
            color: active === tab ? t.primary : t.textMuted,
            boxShadow: active === tab ? `0 1px 4px ${t.shadow}` : "none",
          }}
        >
          {tab === "db" ? <Database size={12} /> : <FileText size={12} />}
          {tab === "db" ? "DB 이력" : "로컬"}
        </button>
      ))}
    </div>
  );
}

// ── DB Jobs Panel ─────────────────────────────────────────────────────────────

function DbJobsPanel({
  isDark, onBack, t, onSwitchTab,
}: {
  isDark: boolean;
  onBack: () => void;
  t: ReturnType<typeof getTheme>;
  onSwitchTab: (v: "local" | "db") => void;
}) {
  const [jobs, setJobs] = useState<DbJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [events, setEvents] = useState<DbEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs?limit=50");
      if (res.ok) setJobs(await res.json());
    } catch (e) {
      console.error("Failed to fetch jobs", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const selectJob = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId);
    setEventsLoading(true);
    setEvents([]);
    try {
      const res = await fetch(`/api/jobs/${jobId}/events`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch (e) {
      console.error("Failed to fetch job events", e);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  return (
    <>
      {/* Left Sidebar */}
      <div
        className="w-1/3 min-w-[300px] max-w-[400px] h-full flex flex-col border-r"
        style={{ borderColor: t.divider, background: t.surface }}
      >
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: t.divider }}>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: t.text }}
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="font-bold text-lg font-serif">Job 이력</h2>
          </div>
          <div className="flex items-center gap-2">
            <TabSwitcher active="db" onChange={onSwitchTab} t={t} />
            <button
              onClick={fetchJobs}
              className="p-2 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: t.textMuted }}
              title="새로고침"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {jobs.length === 0 && !loading ? (
            <div className="text-center py-10" style={{ color: t.textMuted }}>
              <Database size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">저장된 Job이 없습니다.</p>
            </div>
          ) : (
            jobs.map((job) => <JobListItem key={job.id} job={job} selected={job.id === selectedJobId} onClick={() => selectJob(job.id)} t={t} />)
          )}
        </div>
      </div>

      {/* Right: Event Replay */}
      <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col">
        {!selectedJob ? (
          <div className="flex-1 flex flex-col items-center justify-center opacity-40" style={{ color: t.textMuted }}>
            <Database size={56} className="mb-4 opacity-20" />
            <p className="font-serif text-lg">왼쪽에서 Job을 선택해주세요</p>
          </div>
        ) : (
          <JobEventReplay job={selectedJob} events={events} loading={eventsLoading} t={t} />
        )}
      </div>
    </>
  );
}

function JobListItem({
  job, selected, onClick, t,
}: {
  job: DbJob;
  selected: boolean;
  onClick: () => void;
  t: ReturnType<typeof getTheme>;
}) {
  const statusColor = job.status === "completed" ? t.success
    : job.status === "failed" ? t.error
    : job.status === "running" ? t.primary
    : t.textMuted;

  const started = new Date(job.started_at);

  return (
    <div
      onClick={onClick}
      className="p-3 rounded-xl cursor-pointer transition-all border"
      style={{
        background: selected ? t.surface : "transparent",
        borderColor: selected ? t.primary : t.divider,
        boxShadow: selected ? `0 2px 8px ${t.shadow}` : "none",
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono truncate max-w-[60%]" style={{ color: t.textMuted }}>
          {job.id.slice(0, 12)}…
        </span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${statusColor}18`, color: statusColor }}>
          {job.status}
        </span>
      </div>
      <div className="text-xs truncate mb-1.5" style={{ color: t.text }}>
        {job.project_id ?? "unknown project"}
      </div>
      <div className="flex items-center justify-between text-[11px]" style={{ color: t.textMuted }}>
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {started.toLocaleDateString()} {started.toLocaleTimeString()}
        </span>
        {job.duration_ms != null && (
          <span>{(job.duration_ms / 1000).toFixed(1)}s</span>
        )}
      </div>
      {job.page_total > 0 && (
        <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: t.divider }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.round((job.page_done / job.page_total) * 100)}%`,
              background: job.status === "failed" ? t.error : t.primary,
            }}
          />
        </div>
      )}
    </div>
  );
}

function JobEventReplay({
  job, events, loading, t,
}: {
  job: DbJob;
  events: DbEvent[];
  loading: boolean;
  t: ReturnType<typeof getTheme>;
}) {
  const statusColor = job.status === "completed" ? t.success
    : job.status === "failed" ? t.error
    : job.status === "running" ? t.primary
    : t.textMuted;

  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto p-6 flex flex-col gap-4 pb-20">
        {/* Job header */}
        <div
          className="p-5 rounded-2xl border"
          style={{ background: t.surface, borderColor: t.divider }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Database size={16} style={{ color: t.primary }} />
                <span className="font-bold text-sm font-mono" style={{ color: t.text }}>
                  {job.id}
                </span>
              </div>
              <div className="text-xs" style={{ color: t.textMuted }}>
                {job.project_id ?? "—"}
              </div>
            </div>
            <span
              className="text-xs font-semibold px-3 py-1 rounded-full"
              style={{ background: `${statusColor}18`, color: statusColor }}
            >
              {job.status}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
            {[
              { label: "시작", value: new Date(job.started_at).toLocaleString() },
              { label: "소요", value: job.duration_ms != null ? `${(job.duration_ms / 1000).toFixed(1)}s` : "—" },
              { label: "페이지", value: job.page_total > 0 ? `${job.page_done}/${job.page_total}` : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="p-2 rounded-lg text-center" style={{ background: t.bg }}>
                <div style={{ color: t.textMuted }}>{label}</div>
                <div className="font-semibold mt-0.5" style={{ color: t.text }}>{value}</div>
              </div>
            ))}
          </div>

          {job.error && (
            <div
              className="mt-3 p-3 rounded-lg text-xs font-mono"
              style={{ background: `${t.error}12`, color: t.error, borderLeft: `3px solid ${t.error}` }}
            >
              {job.error}
            </div>
          )}
        </div>

        {/* Events */}
        <div className="text-sm font-semibold" style={{ color: t.textMuted }}>
          이벤트 로그 ({events.length})
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10" style={{ color: t.textMuted }}>
            <Loader2 size={24} className="animate-spin mr-2" />
            이벤트 로드 중…
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-sm" style={{ color: t.textMuted }}>
            저장된 이벤트가 없습니다.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {events.map((ev) => <EventRow key={ev.id} event={ev} t={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

const EVENT_COLORS: Record<string, { bg: string; text: string }> = {
  "agent.request":   { bg: "#6366f120", text: "#6366f1" },
  "agent.chunk":     { bg: "#22c55e15", text: "#16a34a" },
  "agent.response":  { bg: "#6366f130", text: "#6366f1" },
  "agent.error":     { bg: "#ef444420", text: "#ef4444" },
  "pipeline.started":   { bg: "#f59e0b18", text: "#d97706" },
  "pipeline.completed": { bg: "#22c55e20", text: "#16a34a" },
  "pipeline.failed":    { bg: "#ef444420", text: "#ef4444" },
  "phase.started":   { bg: "#3b82f615", text: "#3b82f6" },
  "phase.completed": { bg: "#22c55e15", text: "#16a34a" },
  "complete":        { bg: "#22c55e20", text: "#16a34a" },
  "error":           { bg: "#ef444420", text: "#ef4444" },
  "heartbeat":       { bg: "#94a3b815", text: "#94a3b8" },
};

function EventRow({ event: ev, t }: { event: DbEvent; t: ReturnType<typeof getTheme> }) {
  const [expanded, setExpanded] = useState(false);
  const color = EVENT_COLORS[ev.type] ?? { bg: `${t.primary}15`, text: t.primary };
  const hasData = ev.data && Object.keys(ev.data).length > 0;

  // Don't render heartbeat rows unless hovered — keep list clean
  if (ev.type === "heartbeat") return null;

  return (
    <div
      className="rounded-lg border transition-all"
      style={{ background: t.surface, borderColor: t.divider }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => hasData && setExpanded((v) => !v)}
      >
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded font-mono shrink-0"
          style={{ background: color.bg, color: color.text }}
        >
          {ev.type}
        </span>
        {ev.phase && (
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: t.bg, color: t.textMuted }}>
            {ev.phase}
          </span>
        )}
        <span className="text-xs flex-1 truncate" style={{ color: t.text }}>
          {ev.message}
        </span>
        <span className="text-[10px] font-mono shrink-0" style={{ color: t.textMuted }}>
          {new Date(ev.ts).toLocaleTimeString()}
        </span>
        {hasData && (
          <ChevronDown
            size={12}
            style={{ color: t.textMuted, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
          />
        )}
      </div>

      <AnimatePresence>
        {expanded && hasData && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t"
            style={{ borderColor: t.divider }}
          >
            <pre
              className="px-3 py-2 text-[11px] font-mono overflow-x-auto"
              style={{ color: t.text, background: t.bg }}
            >
              {JSON.stringify(ev.data, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Local Logs Panel (unchanged logic, adds tab switcher) ─────────────────────

function LocalLogsPanel({
  isDark, onBack, t, onSwitchTab,
}: {
  isDark: boolean;
  onBack: () => void;
  t: ReturnType<typeof getTheme>;
  onSwitchTab: (v: "local" | "db") => void;
}) {
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADMIN_LOGS_KEY);
      if (raw) setLogs(JSON.parse(raw));
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

  const selectedLog = logs.find((l) => l.id === selectedLogId);

  return (
    <>
      {/* Left Sidebar */}
      <div
        className="w-1/3 min-w-[300px] max-w-[400px] h-full flex flex-col border-r"
        style={{ borderColor: t.divider, background: t.surface }}
      >
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: t.divider }}>
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-lg transition-colors hover:bg-black/5"
              style={{ color: t.text }}
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="font-bold text-lg font-serif">작업 기록 (Admin)</h2>
          </div>
          <div className="flex items-center gap-2">
            <TabSwitcher active="local" onChange={onSwitchTab} t={t} />
            <button
              onClick={handleClearLogs}
              className="p-2 rounded-lg transition-colors hover:bg-red-500/10 text-red-500"
              title="모든 기록 지우기"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {logs.length === 0 ? (
            <div className="text-center py-10" style={{ color: t.textMuted }}>
              <FileText size={48} className="mx-auto mb-4 opacity-20" />
              <p>저장된 작업 기록이 없습니다.</p>
            </div>
          ) : (
            logs.map((log) => {
              const isSelected = log.id === selectedLogId;
              const date = new Date(log.timestamp);
              return (
                <div
                  key={log.id}
                  onClick={() => setSelectedLogId(log.id)}
                  className="p-4 rounded-xl cursor-pointer transition-all duration-200 border"
                  style={{
                    background: isSelected ? t.surface : "transparent",
                    borderColor: isSelected ? t.primary : t.divider,
                    boxShadow: isSelected ? `0 4px 12px ${t.shadow}` : "none",
                  }}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold" style={{ color: t.text }}>{log.projectName}</div>
                    {log.status === "success"
                      ? <CheckCircle size={16} color={t.success} />
                      : <AlertCircle size={16} color={t.error} />}
                  </div>
                  <div className="text-xs truncate mb-2" style={{ color: t.textMuted }}>{log.projectPath}</div>
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

      {/* Right Content */}
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
    </>
  );
}

// ── ReadOnly Local Log Viewer (unchanged) ─────────────────────────────────────

function ReadOnlyLogViewer({ phases, theme: t }: { phases: AnalysisPhase[]; theme: ReturnType<typeof getTheme> }) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(phases.map((p) => p.id)));

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId); else next.add(phaseId);
      return next;
    });
  };

  return (
    <div className="flex-1 w-full h-full flex flex-col overflow-hidden relative">
      <div className="flex-1 overflow-y-auto w-full">
        <div className="w-full max-w-4xl mx-auto flex flex-col gap-6 p-4 md:p-10 pb-20">
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
                <span className="text-sm font-medium" style={{ color: t.textSecondary }}>작업 뷰어 (읽기 전용)</span>
              </div>
            </div>
          </div>

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
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-black/5 transition-colors"
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
                          <div className="text-[13px] mt-0.5" style={{ color: t.textMuted }}>{phase.description}</div>
                        </div>
                      </div>
                      <motion.div animate={{ rotate: isExpanded ? 180 : 0 }}>
                        <ChevronDown size={18} color={t.textMuted} />
                      </motion.div>
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
                              phase.logs.map((log) => <ReadOnlyLogEntry key={log.id} log={log} theme={t} />)
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

function ReadOnlyLogEntry({ log, theme: t }: { log: StreamLog; theme: ReturnType<typeof getTheme> }) {
  const colors = getLogColor(log.type, t);
  const isJson = (() => {
    const c = log.content.trim();
    if (!c.startsWith("{") && !c.startsWith("[")) return false;
    try { JSON.parse(c); return true; } catch { return false; }
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: colors.bg, borderRadius: 6, color: colors.text }}>
          {getLogIcon(log.type)}
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "-0.01em" }}>{getLogLabel(log.type)}</span>
        </div>
        {isJson && (
          <span style={{ fontSize: 10, fontWeight: 600, color: t.textMuted, background: t.surface, padding: "2px 7px", borderRadius: 5 }}>JSON</span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: t.textMuted }}>
          <Clock size={11} />
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "-0.02em" }}>
            {formatTimestamp(new Date(log.timestamp))}
          </span>
        </div>
      </div>
      <div style={{ background: isJson ? (t as any).codeBg ?? t.surface : t.surface, borderRadius: 10, padding: isJson ? "0" : "12px 16px", borderLeft: `3px solid ${colors.border}`, overflow: "hidden" }}>
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
