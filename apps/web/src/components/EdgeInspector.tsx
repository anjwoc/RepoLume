"use client";

import { X } from "lucide-react";
import type { EdgeMetadata } from "@/lib/diagram-edge-types";

interface Props {
  edgeKey: string;
  meta: EdgeMetadata;
  onClose: () => void;
}

function JsonBlock({ data }: { data: unknown }) {
  if (data === undefined || data === null) return <span style={{ color: "var(--muted, #9ca3af)" }}>—</span>;
  return (
    <pre style={{
      margin: 0,
      padding: "8px 10px",
      background: "var(--surface-hover, #f3f4f6)",
      borderRadius: 6,
      fontSize: 11,
      fontFamily: "monospace",
      overflow: "auto",
      maxHeight: 200,
      color: "var(--text, #111)",
    }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted, #9ca3af)", marginBottom: 4 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export function EdgeInspector({ edgeKey, meta, onClose }: Props) {
  const PROTOCOL_COLOR: Record<string, string> = {
    http:  "#3b82f6",
    sql:   "#8b5cf6",
    grpc:  "#10b981",
    event: "#f59e0b",
  };

  return (
    <div style={{
      width: 340,
      flexShrink: 0,
      background: "var(--surface, #fff)",
      borderLeft: "1px solid var(--divider, #e5e7eb)",
      display: "flex",
      flexDirection: "column",
      fontSize: 13,
      fontFamily: "inherit",
      overflowY: "auto",
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "1px solid var(--divider, #e5e7eb)",
        position: "sticky",
        top: 0,
        background: "var(--surface, #fff)",
        zIndex: 1,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            background: PROTOCOL_COLOR[meta.protocol] ?? "#6b7280",
            color: "#fff",
            borderRadius: 4,
            padding: "2px 7px",
            fontWeight: 700,
            fontSize: 11,
            textTransform: "uppercase",
          }}>
            {meta.protocol}
          </span>
          {meta.sideEffect === "mutating" && (
            <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 600 }}>
              mutating
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #6b7280)", display: "flex", alignItems: "center" }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "16px", flex: 1 }}>
        {/* Endpoint */}
        {(meta.method || meta.path || meta.query) && (
          <Row label="엔드포인트">
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text, #111)" }}>
              {meta.method && <strong style={{ marginRight: 6 }}>{meta.method}</strong>}
              {meta.path ?? meta.query}
            </div>
          </Row>
        )}

        {/* Response status */}
        {meta.response?.status !== undefined && (
          <Row label="응답 상태">
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{
                fontWeight: 700,
                color: (typeof meta.response.status === 'number' ? meta.response.status < 400 : meta.response.status === 'ok')
                  ? "#10b981" : "#ef4444",
              }}>
                {meta.response.status}
              </span>
              {meta.response.latencyMs !== undefined && (
                <span style={{ color: "var(--text-secondary, #6b7280)", fontSize: 12 }}>
                  {meta.response.latencyMs}ms
                </span>
              )}
            </div>
          </Row>
        )}

        {/* Request */}
        {meta.request?.body !== undefined && (
          <Row label="Request Body">
            <JsonBlock data={meta.request.body} />
          </Row>
        )}
        {meta.request?.headers && Object.keys(meta.request.headers).length > 0 && (
          <Row label="Request Headers">
            <JsonBlock data={meta.request.headers} />
          </Row>
        )}

        {/* Response */}
        {meta.response?.body !== undefined && (
          <Row label="Response Body">
            <JsonBlock data={meta.response.body} />
          </Row>
        )}

        {/* Extract */}
        {meta.extract && Object.keys(meta.extract).length > 0 && (
          <Row label="추출 변수">
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(meta.extract).map(([varName, path]) => (
                <div key={varName} style={{
                  display: "flex",
                  gap: 8,
                  fontFamily: "monospace",
                  fontSize: 11,
                  padding: "3px 8px",
                  background: "var(--surface-hover, #f3f4f6)",
                  borderRadius: 4,
                }}>
                  <span style={{ color: "#3b82f6", fontWeight: 700 }}>{"{{" + varName + "}}"}</span>
                  <span style={{ color: "var(--text-secondary, #6b7280)" }}>← {path}</span>
                </div>
              ))}
            </div>
          </Row>
        )}

        {/* Edge key (debug) */}
        <div style={{ marginTop: 16, fontSize: 10, color: "var(--muted, #9ca3af)", fontFamily: "monospace" }}>
          {edgeKey}
        </div>
      </div>
    </div>
  );
}
