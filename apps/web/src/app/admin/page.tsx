"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft, RefreshCw, Loader2, Database, CheckCircle2,
  XCircle, Clock, Activity, ChevronRight, ChevronDown,
  Cpu, Link2, FileText, Zap, Globe, Square, SquareCheckBig, Rocket,
} from "lucide-react";
import { getTheme } from "@/lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunSummary {
  job_id: string;
  project_id: string | null;
  status: "pending" | "running" | "completed" | "failed";
  current_phase: string | null;
  page_total: number;
  page_done: number;
  page_failed: number;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  mcp_providers: string[];
  entities: Record<string, number>;
}

interface EventRow {
  id: number;
  job_id: string;
  seq: number;
  type: string;
  phase: string | null;
  message: string;
  data: Record<string, unknown>;
  ts: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PHASE_ORDER = ["scan", "structure", "extract", "mcp", "generation", "synthesis", "save"];
const PHASE_LABELS: Record<string, string> = {
  scan: "파일 스캔", structure: "구조 분석", extract: "엔티티 추출",
  mcp: "MCP 크로스체크", generation: "페이지 생성", synthesis: "인사이트 생성", save: "저장",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setIsDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const t = getTheme(isDark);

  return (
    <div className="flex w-full min-h-screen" style={{ background: t.bg, color: t.text }}>
      <AdminDashboard isDark={isDark} t={t} />
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function AdminDashboard({ isDark, t }: { isDark: boolean; t: ReturnType<typeof getTheme> }) {
  const [tab, setTab] = useState<"runs" | "showcase">("runs");
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/runs?limit=40");
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } catch (e) {
      console.error("Failed to fetch runs", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === "runs") fetchRuns(); }, [fetchRuns, tab]);

  const selectedRun = runs.find((r) => r.job_id === selectedId) ?? null;

  return (
    <div className="flex w-full h-screen overflow-hidden">
      {/* Left sidebar */}
      <div
        className="w-[340px] flex-shrink-0 h-full flex flex-col border-r"
        style={{ borderColor: t.divider, background: t.surface }}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center gap-2" style={{ borderColor: t.divider }}>
          <a href="/" className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: t.textMuted }}>
            <ArrowLeft size={16} />
          </a>
          <span className="font-semibold text-sm flex-1">Admin</span>
          {tab === "runs" && (
            <button onClick={fetchRuns} className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" style={{ color: t.textMuted }}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex border-b" style={{ borderColor: t.divider }}>
          {(["runs", "showcase"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="flex-1 py-2.5 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
              style={{
                borderBottom: tab === id ? `2px solid ${t.primary}` : "2px solid transparent",
                color: tab === id ? t.primary : t.textMuted,
                background: "transparent",
              }}
            >
              {id === "runs" ? <><Activity size={13} />Pipeline</> : <><Globe size={13} />Showcase</>}
            </button>
          ))}
        </div>

        {tab === "runs" ? (
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {runs.length === 0 && !loading ? (
              <div className="flex flex-col items-center justify-center h-full opacity-40" style={{ color: t.textMuted }}>
                <Database size={36} className="mb-3" />
                <p className="text-sm">실행 이력이 없습니다</p>
              </div>
            ) : (
              runs.map((run) => (
                <RunListItem key={run.job_id} run={run} selected={run.job_id === selectedId} onClick={() => setSelectedId(run.job_id)} t={t} />
              ))
            )}
          </div>
        ) : (
          <ShowcasePanel t={t} />
        )}
      </div>

      {/* Right: detail panel (runs only) */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {tab === "runs" ? (
          selectedRun ? (
            <RunDetailPanel run={selectedRun} isDark={isDark} t={t} />
          ) : (
            <div className="flex-1 h-full flex flex-col items-center justify-center opacity-30" style={{ color: t.textMuted }}>
              <Activity size={48} className="mb-4" />
              <p className="text-base">왼쪽에서 실행을 선택하세요</p>
            </div>
          )
        ) : (
          <div className="flex-1 h-full flex flex-col items-center justify-center opacity-20" style={{ color: t.textMuted }}>
            <Globe size={48} className="mb-4" />
            <p className="text-base">Showcase 탭에서 위키를 선택하고 배포하세요</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Showcase Panel ─────────────────────────────────────────────────────────────

interface CacheMeta {
  id: string;
  repo: string;
  owner: string;
  repo_type: string;
  language: string;
  model: string | null;
  pages: number;
  sections: number;
  submittedAt: number;
}

function ShowcasePanel({ t }: { t: ReturnType<typeof getTheme> }) {
  const [caches, setCaches] = useState<CacheMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchCaches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/showcase");
      if (res.ok) {
        const data = await res.json();
        setCaches(data.caches ?? []);
        setSelected(new Set(data.selected ?? []));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCaches(); }, [fetchCaches]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const toggle = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/admin/showcase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: [...selected] }) });
    } finally { setSaving(false); }
  };

  const handleDeploy = async () => {
    setSaving(true);
    await fetch("/api/admin/showcase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selected: [...selected] }) });
    setSaving(false);
    setDeploying(true);
    setLog([]);
    const es = new EventSource("/api/admin/showcase/deploy");
    es.onmessage = (e) => {
      if (e.data === "__DONE__") { es.close(); setDeploying(false); return; }
      try { setLog(prev => [...prev, JSON.parse(e.data)]); } catch { setLog(prev => [...prev, e.data]); }
    };
    es.onerror = () => { es.close(); setDeploying(false); setLog(prev => [...prev, "❌ 연결 오류"]); };
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Wiki list */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {loading ? (
          <div className="flex items-center justify-center h-20 opacity-40" style={{ color: t.textMuted }}>
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : caches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 opacity-40" style={{ color: t.textMuted }}>
            <Database size={28} className="mb-2" />
            <p className="text-xs">위키 캐시가 없습니다</p>
          </div>
        ) : caches.map(c => {
          const on = selected.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggle(c.id)}
              className="w-full text-left rounded-xl px-3 py-2.5 flex items-start gap-2.5 transition-colors"
              style={{ background: on ? t.primaryLight : "transparent", border: `1px solid ${on ? t.primary + "40" : t.divider}` }}
            >
              <span className="mt-0.5 flex-shrink-0" style={{ color: on ? t.primary : t.textMuted }}>
                {on ? <SquareCheckBig size={15} /> : <Square size={15} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate" style={{ color: on ? t.primary : t.text }}>
                  {c.repo}
                </div>
                <div className="text-[11px] mt-0.5 flex gap-2 flex-wrap" style={{ color: t.textMuted }}>
                  <span>{c.language}</span>
                  {c.model && <span className="truncate max-w-[120px]">{c.model}</span>}
                  <span>{c.pages}p · {c.sections}s</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Deploy log */}
      {log.length > 0 && (
        <div
          ref={logRef}
          className="border-t p-2 overflow-y-auto font-mono"
          style={{ maxHeight: 180, fontSize: 10, background: t.bg, borderColor: t.divider, color: t.textMuted, whiteSpace: "pre-wrap", wordBreak: "break-all" }}
        >
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* Actions */}
      <div className="border-t p-3 flex flex-col gap-2" style={{ borderColor: t.divider }}>
        <div className="text-xs text-center" style={{ color: t.textMuted }}>
          {selected.size}개 선택됨
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || deploying}
            className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            style={{ background: t.surface, border: `1px solid ${t.divider}`, color: t.text }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
            저장만
          </button>
          <button
            onClick={handleDeploy}
            disabled={saving || deploying || selected.size === 0}
            className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            style={{ background: t.primary, color: "#fff" }}
          >
            {deploying ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
            {deploying ? "배포 중..." : "Vercel 배포"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Run List Item ─────────────────────────────────────────────────────────────

function RunListItem({
  run, selected, onClick, t,
}: {
  run: RunSummary;
  selected: boolean;
  onClick: () => void;
  t: ReturnType<typeof getTheme>;
}) {
  const statusColor =
    run.status === "completed" ? t.success
    : run.status === "failed" ? t.error
    : run.status === "running" ? t.primary
    : t.textMuted;

  const StatusIcon =
    run.status === "completed" ? CheckCircle2
    : run.status === "failed" ? XCircle
    : run.status === "running" ? Activity
    : Clock;

  const started = new Date(run.started_at);
  const label = run.project_id
    ? run.project_id.replace(/^.*[/\\]/, "")
    : run.job_id.slice(0, 8);

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 rounded-lg transition-colors"
      style={{
        background: selected ? t.primaryLight : "transparent",
        border: `1px solid ${selected ? t.primaryBorder : "transparent"}`,
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold truncate max-w-[180px]" style={{ color: t.text }}>{label}</span>
        <StatusIcon size={13} style={{ color: statusColor, flexShrink: 0 }} />
      </div>
      <div className="flex items-center gap-3 text-[11px]" style={{ color: t.textMuted }}>
        <span>{started.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        {run.duration_ms != null && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
        {run.page_done > 0 && <span>{run.page_done}p</span>}
      </div>
      {(run.mcp_providers.length > 0 || Object.keys(run.entities).length > 0) && (
        <div className="flex gap-1 mt-1.5 flex-wrap">
          {run.mcp_providers.map((p) => (
            <span key={p} className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: t.primaryLight, color: t.primary }}>{p}</span>
          ))}
          {Object.entries(run.entities).filter(([, v]) => v > 0).slice(0, 2).map(([k, v]) => (
            <span key={k} className="px-1.5 py-0.5 rounded text-[10px]"
              style={{ background: t.surfaceHover, color: t.textMuted }}>{k}:{v}</span>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Run Detail Panel ──────────────────────────────────────────────────────────

function RunDetailPanel({
  run, isDark, t,
}: {
  run: RunSummary;
  isDark: boolean;
  t: ReturnType<typeof getTheme>;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(async (jobId: string) => {
    setLoading(true);
    setEvents([]);
    setSelectedEvent(null);
    try {
      const res = await fetch(`/api/admin/runs/${jobId}/timeline?limit=2000`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch (e) {
      console.error("Failed to fetch timeline", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    sseRef.current?.close();
    fetchEvents(run.job_id);

    if (run.status === "running") {
      const es = new EventSource(`/api/admin/runs/${run.job_id}/stream`);
      sseRef.current = es;
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === "run.ended") { es.close(); return; }
          setEvents((prev) => {
            const exists = prev.some((p) => p.seq === ev.seq);
            return exists ? prev : [...prev, ev];
          });
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
        } catch {}
      };
      return () => es.close();
    }
  }, [run.job_id, run.status, fetchEvents]);

  // Group events by phase
  const phaseGroups = groupByPhase(events);
  const statusColor =
    run.status === "completed" ? t.success
    : run.status === "failed" ? t.error
    : run.status === "running" ? t.primary
    : t.textMuted;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Run header */}
      <div className="p-4 border-b flex items-start justify-between" style={{ borderColor: t.divider }}>
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold" style={{ color: t.text }}>
              {run.project_id ?? run.job_id}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: run.status === "completed" ? t.successLight : run.status === "failed" ? t.errorLight : t.primaryLight, color: statusColor }}>
              {run.status}
            </span>
          </div>
          <div className="flex gap-4 text-xs" style={{ color: t.textMuted }}>
            <span>시작: {new Date(run.started_at).toLocaleString("ko-KR")}</span>
            {run.duration_ms != null && <span>소요: {(run.duration_ms / 1000).toFixed(1)}s</span>}
            <span>페이지: {run.page_done}/{run.page_total}</span>
          </div>
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {run.mcp_providers.map((p) => (
            <span key={p} className="flex items-center gap-1 px-2 py-0.5 rounded text-xs"
              style={{ background: t.primaryLight, color: t.primary }}>
              <Link2 size={10} />{p}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Phase timeline */}
        <div className="w-[240px] flex-shrink-0 border-r h-full overflow-y-auto p-3 flex flex-col gap-1"
          style={{ borderColor: t.divider }}>
          {PHASE_ORDER.map((phase) => {
            const evs = phaseGroups[phase] ?? [];
            if (evs.length === 0) return null;
            const isExpanded = expandedPhase === phase;
            const hasError = evs.some((e) => e.type.includes("failed") || e.type === "error");
            const isComplete = evs.some((e) => e.type === "phase.completed");
            const phaseColor = hasError ? t.error : isComplete ? t.success : t.primary;

            return (
              <div key={phase}>
                <button
                  onClick={() => setExpandedPhase(isExpanded ? null : phase)}
                  className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 transition-colors hover:bg-black/5"
                  style={{ background: isExpanded ? t.primaryLight : "transparent" }}
                >
                  <span style={{ color: phaseColor, flexShrink: 0 }}>
                    {hasError ? <XCircle size={13} /> : isComplete ? <CheckCircle2 size={13} /> : <Activity size={13} />}
                  </span>
                  <span className="flex-1 text-xs font-medium truncate" style={{ color: t.text }}>
                    {PHASE_LABELS[phase] ?? phase}
                  </span>
                  <span className="text-[10px]" style={{ color: t.textMuted }}>{evs.length}</span>
                  {isExpanded ? <ChevronDown size={12} style={{ color: t.textMuted }} /> : <ChevronRight size={12} style={{ color: t.textMuted }} />}
                </button>

                {isExpanded && evs.map((ev) => (
                  <button
                    key={ev.seq}
                    onClick={() => setSelectedEvent(ev === selectedEvent ? null : ev)}
                    className="w-full text-left px-4 py-1.5 text-[11px] rounded-md ml-2 transition-colors hover:bg-black/5 truncate"
                    style={{
                      color: ev === selectedEvent ? t.primary : t.textMuted,
                      background: ev === selectedEvent ? t.primaryLight : "transparent",
                      maxWidth: "192px",
                    }}
                  >
                    {ev.type.split(".").pop() ?? ev.type}
                  </button>
                ))}
              </div>
            );
          })}

          {/* Ungrouped */}
          {(phaseGroups[""] ?? []).length > 0 && (
            <div className="mt-2 border-t pt-2" style={{ borderColor: t.divider }}>
              {(phaseGroups[""] ?? []).map((ev) => (
                <button key={ev.seq}
                  onClick={() => setSelectedEvent(ev === selectedEvent ? null : ev)}
                  className="w-full text-left px-2.5 py-1.5 text-[11px] rounded-md transition-colors hover:bg-black/5 truncate"
                  style={{ color: t.textMuted }}>
                  {ev.type}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Event detail / raw log */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 opacity-50" style={{ color: t.textMuted }}>
              <Loader2 size={16} className="animate-spin" /> 이벤트 로딩 중...
            </div>
          ) : selectedEvent ? (
            <EventDetail event={selectedEvent} t={t} />
          ) : (
            <EventLog events={events} t={t} onSelect={setSelectedEvent} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

// ── Event Detail ──────────────────────────────────────────────────────────────

function EventDetail({ event, t }: { event: EventRow; t: ReturnType<typeof getTheme> }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Zap size={14} style={{ color: t.primary }} />
        <span className="text-sm font-semibold" style={{ color: t.text }}>{event.type}</span>
        <span className="text-xs" style={{ color: t.textMuted }}>seq:{event.seq}</span>
      </div>

      {event.message && (
        <div className="text-sm" style={{ color: t.text }}>{event.message}</div>
      )}

      {event.data && Object.keys(event.data).length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-2 flex items-center gap-1" style={{ color: t.textMuted }}>
            <FileText size={11} /> Data
          </div>
          {/* Special rendering for mcp_context, table schema */}
          {typeof event.data.context_bytes === "number" && (
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: t.text }}>
              <Database size={12} style={{ color: t.primary }} />
              <span>{event.data.provider as string}</span>
              <span style={{ color: t.textMuted }}>{event.data.context_bytes as number} bytes</span>
              {event.data.tables_resolved != null && <span style={{ color: t.textMuted }}>테이블 {event.data.tables_resolved as number}개</span>}
            </div>
          )}
          {typeof event.data.tables === "number" && (
            <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: t.text }}>
              <Cpu size={12} style={{ color: t.primary }} />
              <span>tables:{event.data.tables as number}</span>
              <span>procs:{event.data.procs as number}</span>
              <span>topics:{event.data.topics as number}</span>
              <span>source:{event.data.source as string}</span>
            </div>
          )}
          <pre
            className="text-xs rounded-lg p-3 overflow-auto max-h-[400px]"
            style={{ background: t.surface, color: t.textMuted, border: `1px solid ${t.divider}` }}
          >
            {JSON.stringify(event.data, null, 2)}
          </pre>
        </div>
      )}

      <div className="text-xs" style={{ color: t.textMuted }}>
        {new Date(event.ts).toLocaleString("ko-KR")}
      </div>
    </div>
  );
}

// ── Event Log (full list) ─────────────────────────────────────────────────────

function EventLog({
  events, t, onSelect,
}: {
  events: EventRow[];
  t: ReturnType<typeof getTheme>;
  onSelect: (e: EventRow) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 opacity-30" style={{ color: t.textMuted }}>
        <Activity size={32} className="mb-2" />
        <p className="text-sm">이벤트가 없습니다</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {events.map((ev) => (
        <button
          key={ev.seq}
          onClick={() => onSelect(ev)}
          className="w-full text-left px-3 py-1.5 rounded-md flex items-start gap-3 hover:bg-black/5 transition-colors group"
        >
          <span className="text-[10px] font-mono mt-0.5 flex-shrink-0 w-[28px] text-right" style={{ color: t.textMuted }}>
            {ev.seq}
          </span>
          <span className="text-[11px] font-medium flex-shrink-0 w-[160px] truncate" style={{ color: typeColor(ev.type, t) }}>
            {ev.type}
          </span>
          <span className="text-[11px] flex-1 truncate" style={{ color: t.text }}>
            {ev.message}
          </span>
          <span className="text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: t.textMuted }}>
            {new Date(ev.ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        </button>
      ))}
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function groupByPhase(events: EventRow[]): Record<string, EventRow[]> {
  const groups: Record<string, EventRow[]> = {};
  for (const ev of events) {
    const key = ev.phase ?? "";
    (groups[key] ??= []).push(ev);
  }
  return groups;
}

function typeColor(type: string, t: ReturnType<typeof getTheme>): string {
  if (type.includes("failed") || type === "error") return t.error;
  if (type.includes("completed") || type === "complete") return t.success;
  if (type.includes("started") || type.includes("start")) return t.primary;
  if (type.startsWith("mcp.")) return "#f59e0b";
  if (type.startsWith("entity.") || type.startsWith("synthesis.")) return "#8b5cf6";
  return t.textMuted;
}
