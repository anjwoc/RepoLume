"use client";

import { useEffect, useRef } from "react";
import type { EdgeMetadata } from "@/lib/diagram-edge-types";

interface Props {
  meta: EdgeMetadata;
  anchorRect: DOMRect;
  containerRect: DOMRect;
}

const PROTOCOL_COLOR: Record<string, string> = {
  http:  "#3b82f6",
  sql:   "#8b5cf6",
  grpc:  "#10b981",
  event: "#f59e0b",
};

export function EdgePopover({ meta, anchorRect, containerRect }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Position: prefer below the anchor, flip above if near bottom
  const top = anchorRect.bottom - containerRect.top + 8;
  const left = anchorRect.left - containerRect.left;

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      el.style.left = `${Math.max(8, window.innerWidth - rect.width - 8) - containerRect.left}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      el.style.top = `${anchorRect.top - containerRect.top - rect.height - 8}px`;
    }
  });

  const statusOk = meta.response?.status !== undefined
    ? (typeof meta.response.status === 'number' ? meta.response.status < 400 : meta.response.status === 'ok')
    : null;

  const bodyPreview = meta.response?.body
    ? JSON.stringify(meta.response.body).slice(0, 120)
    : meta.request?.body
    ? JSON.stringify(meta.request.body).slice(0, 120)
    : null;

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top,
        left,
        zIndex: 50,
        background: "var(--surface, #fff)",
        border: "1px solid var(--divider, #e5e7eb)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        padding: "10px 14px",
        minWidth: 220,
        maxWidth: 340,
        fontSize: 12,
        pointerEvents: "none",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span style={{
          background: PROTOCOL_COLOR[meta.protocol] ?? "#6b7280",
          color: "#fff",
          borderRadius: 4,
          padding: "1px 6px",
          fontWeight: 700,
          fontSize: 10,
          textTransform: "uppercase",
        }}>
          {meta.protocol}
        </span>
        {meta.method && (
          <span style={{ fontWeight: 700, color: "var(--text, #111)" }}>{meta.method}</span>
        )}
        {meta.path && (
          <span style={{ color: "var(--text-secondary, #6b7280)", fontFamily: "monospace" }}>{meta.path}</span>
        )}
        {meta.query && (
          <span style={{ color: "var(--text-secondary, #6b7280)", fontFamily: "monospace" }}>
            {meta.query.slice(0, 40)}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, color: "var(--text-secondary, #6b7280)" }}>
        {meta.response?.status !== undefined && (
          <span style={{ color: statusOk ? "#10b981" : "#ef4444", fontWeight: 600 }}>
            {meta.response.status}
          </span>
        )}
        {meta.response?.latencyMs !== undefined && (
          <span>{meta.response.latencyMs}ms</span>
        )}
        {meta.sideEffect === "mutating" && (
          <span style={{ color: "#f59e0b", fontWeight: 600 }}>mutating</span>
        )}
      </div>

      {bodyPreview && (
        <div style={{
          marginTop: 8,
          padding: "4px 8px",
          background: "var(--surface-hover, #f3f4f6)",
          borderRadius: 4,
          fontFamily: "monospace",
          fontSize: 11,
          color: "var(--text-secondary, #6b7280)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {bodyPreview}{bodyPreview.length >= 120 ? "…" : ""}
        </div>
      )}

      <div style={{ marginTop: 6, color: "var(--muted, #9ca3af)", fontSize: 10 }}>
        클릭하면 자세히 보기
      </div>
    </div>
  );
}
