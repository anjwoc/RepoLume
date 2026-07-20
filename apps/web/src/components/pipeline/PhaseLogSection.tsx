"use client";
import { useState } from "react";
import { StreamLog, AnalysisPhase } from "@/lib/stream-types";
import { getTheme } from "@/lib/theme";

type Theme = ReturnType<typeof getTheme>;

// ── Badge config per log type ─────────────────────────────────────────────────

const TYPE_META: Record<string, { label: string; color: string; bg: string }> = {
  "info":           { label: "info",     color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  "system":         { label: "system",   color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  "thinking":       { label: "think",    color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  "question":       { label: "ask",      color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  "answer":         { label: "answer",   color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  "tool_call":      { label: "call",     color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  "tool_result":    { label: "result",   color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
  "progress":       { label: "progress", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  "error":          { label: "error",    color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  "agent.request":  { label: "prompt",   color: "#fb923c", bg: "rgba(251,146,60,0.12)" },
  "agent.response": { label: "response", color: "#c084fc", bg: "rgba(192,132,252,0.12)" },
};

function getMeta(type: string) {
  return TYPE_META[type] ?? { label: type, color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
}

function formatTs(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

// ── Single compact log row ────────────────────────────────────────────────────

function LogRow({ log, t }: { log: StreamLog; t: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getMeta(log.type);

  const isJson = (() => {
    const c = log.content.trim();
    if (!c.startsWith("{") && !c.startsWith("[")) return false;
    try { JSON.parse(c); return true; } catch { return false; }
  })();

  const firstLine = log.content.split("\n")[0];
  const isLong = log.content.length > 120 || log.content.includes("\n");

  return (
    <div
      onClick={() => isLong && setExpanded(v => !v)}
      style={{
        display: "grid",
        gridTemplateColumns: "68px 72px 1fr",
        alignItems: "start",
        gap: "0 8px",
        padding: "1px 4px",
        borderRadius: 4,
        cursor: isLong ? "pointer" : "default",
        background: "transparent",
        transition: "background 0.1s",
        minHeight: 18,
      }}
      onMouseEnter={e => { if (isLong) e.currentTarget.style.background = (t as any).surfaceHover ?? "rgba(128,128,128,0.08)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {/* Timestamp */}
      <span style={{
        fontFamily: "var(--font-mono), monospace",
        fontSize: 10,
        color: t.textMuted,
        lineHeight: "18px",
        userSelect: "none",
        flexShrink: 0,
      }}>
        {formatTs(log.timestamp)}
      </span>

      {/* Badge */}
      <span style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: "16px",
        background: meta.bg,
        color: meta.color,
        letterSpacing: "0.02em",
        alignSelf: "start",
        flexShrink: 0,
      }}>
        {meta.label}
      </span>

      {/* Content */}
      <span style={{
        fontFamily: isJson
          ? "var(--font-mono), 'JetBrains Mono', monospace"
          : "var(--font-sans), -apple-system, sans-serif",
        fontSize: 11,
        color: t.text,
        lineHeight: "18px",
        wordBreak: "break-word",
        whiteSpace: expanded ? "pre-wrap" : "nowrap",
        overflow: expanded ? "visible" : "hidden",
        textOverflow: expanded ? "clip" : "ellipsis",
      }}>
        {expanded ? log.content : firstLine}
        {isLong && !expanded && (
          <span style={{ color: t.textMuted, marginLeft: 4, fontSize: 10 }}>…</span>
        )}
      </span>
    </div>
  );
}

// ── Phase separator header ────────────────────────────────────────────────────

function PhaseDivider({ phase, t }: { phase: AnalysisPhase; t: Theme }) {
  const icon = (() => {
    if (phase.status === "completed") return "✓";
    if (phase.status === "in_progress") return "●";
    if (phase.status === "error") return "✗";
    return "○";
  })();

  const iconColor = phase.status === "completed" ? "#4ade80"
    : phase.status === "error" ? "#f87171"
    : phase.status === "in_progress" ? "#60a5fa"
    : t.textMuted;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 0 2px",
      userSelect: "none",
    }}>
      <span style={{ color: t.divider, fontSize: 10, letterSpacing: "0.1em", flexShrink: 0 }}>──</span>
      <span style={{
        fontSize: 10, fontWeight: 700, color: t.textSecondary,
        letterSpacing: "0.06em", textTransform: "uppercase", whiteSpace: "nowrap",
      }}>
        {phase.name}
      </span>
      <span style={{ color: iconColor, fontSize: 11, fontWeight: 700 }}>{icon}</span>
      <span style={{ flex: 1, height: 1, background: t.divider, minWidth: 8 }} />
    </div>
  );
}

// ── PhaseLogSection ──────────────────────────────────────────────────────────

export function PhaseLogSection({ phase, theme: t }: { phase: AnalysisPhase; theme: Theme }) {
  if (phase.logs.length === 0 && phase.status === "pending") return null;

  return (
    <div style={{ marginBottom: 4 }}>
      <PhaseDivider phase={phase} t={t} />
      <div style={{ paddingLeft: 2 }}>
        {phase.logs.map(log => (
          <LogRow key={log.id} log={log} t={t} />
        ))}
      </div>
    </div>
  );
}
