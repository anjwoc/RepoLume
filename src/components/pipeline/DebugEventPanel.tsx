"use client";
import { useRef, useEffect, useState } from "react";
import type { DebugEvent } from "./usePipelineState";

interface Props {
  events: DebugEvent[];
  onClear: () => void;
  theme: any;
}

const PHASE_COLORS: Record<string, string> = {
  structure: "#3b82f6",
  generation: "#8b5cf6",
  insights: "#f59e0b",
  indexing: "#10b981",
  system: "#6b7280",
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function rowOpacity(type: string): number {
  if (type === "heartbeat") return 0.3;
  if (type === "error") return 1;
  return 0.85;
}

function rowColor(type: string, t: any): string {
  if (type === "error") return "#ef4444";
  if (type === "phase_complete" || type === "complete") return "#10b981";
  return t.text;
}

export function DebugEventPanel({ events, onClear, theme: t }: Props) {
  const [live, setLive] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, live]);

  return (
    <div style={{
      margin: "0 0 12px 0",
      border: `1px solid ${t.divider}`,
      borderRadius: 10,
      overflow: "hidden",
      background: t.surface,
      fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 12px",
        borderBottom: collapsed ? "none" : `1px solid ${t.divider}`,
        background: t.surfaceHover,
        cursor: "pointer",
      }} onClick={() => setCollapsed(v => !v)}>
        <span style={{ fontSize: 11, fontWeight: 600, color: t.textSecondary, letterSpacing: "0.05em" }}>
          DEBUG EVENTS ({events.length})
        </span>
        <div style={{ display: "flex", gap: 8 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setLive(v => !v)}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, border: `1px solid ${t.divider}`,
              background: live ? "#10b981" : t.surface, color: live ? "white" : t.textSecondary,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            {live ? "● LIVE" : "○ PAUSED"}
          </button>
          <button
            onClick={onClear}
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 4, border: `1px solid ${t.divider}`,
              background: "transparent", color: t.textSecondary,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            clear
          </button>
          <span style={{ fontSize: 11, color: t.textSecondary, userSelect: "none" }}>
            {collapsed ? "▸" : "▾"}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div
          ref={listRef}
          style={{
            height: 240, overflowY: "auto",
            padding: "4px 0",
          }}
        >
          {events.length === 0 ? (
            <div style={{ padding: "16px 12px", fontSize: 11, color: t.textSecondary, opacity: 0.5 }}>
              이벤트 없음 — 파이프라인이 시작되면 여기에 표시됩니다.
            </div>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 80px 100px 1fr",
                  gap: "0 8px",
                  padding: "1px 12px",
                  fontSize: 10,
                  lineHeight: "18px",
                  opacity: rowOpacity(ev.type),
                  color: rowColor(ev.type, t),
                }}
              >
                <span style={{ color: t.textSecondary, whiteSpace: "nowrap" }}>{fmtTime(ev.ts)}</span>
                <span style={{
                  display: "inline-block", padding: "0 4px", borderRadius: 3,
                  background: (PHASE_COLORS[ev.phase] ?? "#6b7280") + "22",
                  color: PHASE_COLORS[ev.phase] ?? t.textSecondary,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{ev.phase}</span>
                <span style={{
                  color: t.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{ev.type}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ev.message}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
