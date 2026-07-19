"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Clock,
  FileText,
  FolderOpen,
  RefreshCw,
  ArrowLeft,
} from "lucide-react";

import { BACKEND_URL as API } from "@/lib/backend-url";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderResult {
  provider: string;
  status: "OK" | "ERROR" | "SKIPPED";
  error: string;
  duration_s: number;
}

interface BenchmarkRun {
  timestamp: string;
  repo: string;
  module: string;
  results: ProviderResult[];
}

interface Selection {
  timestamp: string;
  provider: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  // "20260612_134222" → "2026-06-12  13:42"
  const m = ts.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/);
  if (!m) return ts;
  return `${m[1]}-${m[2]}-${m[3]}  ${m[4]}:${m[5]}`;
}

function shortModule(module: string): string {
  const parts = module.replace(/\\/g, "/").split("/");
  return parts.slice(-3).join("/");
}

function StatusIcon({ status }: { status: string }) {
  if (status === "OK")
    return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
  if (status === "ERROR")
    return <XCircle size={12} className="text-red-500 shrink-0" />;
  return <MinusCircle size={12} className="text-zinc-600 shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    OK: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    ERROR: "bg-red-500/10 text-red-400 border-red-500/20",
    SKIPPED: "bg-zinc-800 text-zinc-500 border-zinc-700",
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${map[status] ?? map.SKIPPED}`}
    >
      {status}
    </span>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────────

function RunRow({
  run,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  run: BenchmarkRun;
  expanded: boolean;
  selected: Selection | null;
  onToggle: () => void;
  onSelect: (provider: string) => void;
}) {
  const okCount = run.results.filter((r) => r.status === "OK").length;

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-zinc-800/60 transition-colors text-left group"
      >
        <span className="mt-0.5 text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-zinc-300 tabular-nums">
              {formatTimestamp(run.timestamp)}
            </span>
            <span className="text-[10px] text-zinc-600">
              {okCount}/{run.results.length}
            </span>
          </div>
          <div className="text-[10px] text-zinc-600 truncate mt-0.5">
            {shortModule(run.module)}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="ml-5 border-l border-zinc-800">
          {run.results.map((r) => {
            const isActive =
              selected?.timestamp === run.timestamp &&
              selected?.provider === r.provider;
            return (
              <button
                key={r.provider}
                onClick={() => r.status === "OK" && onSelect(r.provider)}
                disabled={r.status !== "OK"}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
                  ${r.status !== "OK" ? "opacity-50 cursor-not-allowed" : "hover:bg-zinc-800/60 cursor-pointer"}
                  ${isActive ? "bg-zinc-800 border-l-2 border-emerald-500 -ml-px pl-[13px]" : ""}`}
              >
                <StatusIcon status={r.status} />
                <span className="text-[11px] font-mono text-zinc-300 truncate flex-1">
                  {r.provider}
                </span>
                {r.duration_s > 0 && (
                  <span className="text-[10px] text-zinc-600 tabular-nums shrink-0">
                    {r.duration_s}s
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Content panel ──────────────────────────────────────────────────────────────

function ContentPanel({
  run,
  provider,
  content,
  loading,
}: {
  run: BenchmarkRun | null;
  provider: string | null;
  content: string | null;
  loading: boolean;
}) {
  if (!run || !provider) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-700">
        <FileText size={32} strokeWidth={1} />
        <span className="text-sm font-mono">Select a provider to view output</span>
      </div>
    );
  }

  const result = run.results.find((r) => r.provider === provider);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Metadata bar */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-5 py-3 space-y-1.5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-mono font-semibold text-zinc-200">{provider}</span>
          {result && <StatusBadge status={result.status} />}
          {result?.duration_s ? (
            <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-500">
              <Clock size={11} />
              {result.duration_s}s
            </span>
          ) : null}
          {content && (
            <span className="text-[11px] font-mono text-zinc-600">
              {content.length.toLocaleString()} chars
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-zinc-600 truncate">
          <span className="text-zinc-500">module</span>{" "}
          {shortModule(run.module)}
        </div>
        <div className="text-[11px] font-mono text-zinc-700 truncate">
          <span className="text-zinc-600">repo</span>{" "}
          {run.repo}
        </div>
      </div>

      {/* Markdown content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 gap-2 text-zinc-600">
            <RefreshCw size={14} className="animate-spin" />
            <span className="text-xs font-mono">Loading...</span>
          </div>
        ) : content ? (
          <div className="px-8 py-6 max-w-[860px] mx-auto prose-benchmark">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 text-zinc-600 text-xs font-mono">
            No content available
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BenchmarkPage() {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Selection | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/benchmark/runs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: BenchmarkRun[] = await res.json();
      setRuns(data);
      // Auto-expand the newest run
      if (data.length > 0) {
        setExpanded(new Set([data[0].timestamp]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  const selectProvider = useCallback(
    async (timestamp: string, provider: string) => {
      setSelected({ timestamp, provider });
      setContent(null);
      setContentLoading(true);
      try {
        const res = await fetch(
          `${API}/api/benchmark/runs/${timestamp}/content?provider=${encodeURIComponent(provider)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setContent(data.content ?? "");
      } catch {
        setContent("Failed to load content.");
      } finally {
        setContentLoading(false);
      }
    },
    []
  );

  const selectedRun = selected
    ? runs.find((r) => r.timestamp === selected.timestamp) ?? null
    : null;

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-300 font-sans overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-[272px] shrink-0 flex flex-col border-r border-zinc-800 bg-[#0d0d0d]">
        {/* Sidebar header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <a
              href="/"
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Back"
            >
              <ArrowLeft size={14} />
            </a>
            <span className="text-xs font-mono font-semibold text-zinc-300 uppercase tracking-wider">
              Benchmark
            </span>
          </div>
          <button
            onClick={fetchRuns}
            disabled={loading}
            className="text-zinc-600 hover:text-zinc-400 transition-colors disabled:opacity-40"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Run list */}
        <div className="flex-1 overflow-y-auto">
          {error ? (
            <div className="px-4 py-6 text-xs font-mono text-red-500">
              {error}
              <br />
              <span className="text-zinc-600">Is the API running on :8001?</span>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs font-mono text-zinc-600">
              <RefreshCw size={12} className="animate-spin" />
              Loading runs...
            </div>
          ) : runs.length === 0 ? (
            <div className="px-4 py-6 space-y-2">
              <div className="flex items-center gap-2 text-zinc-600">
                <FolderOpen size={14} />
                <span className="text-xs font-mono">No runs yet</span>
              </div>
              <p className="text-[11px] font-mono text-zinc-700 leading-relaxed">
                Run <code className="text-zinc-500">pnpm benchmark</code> to
                generate your first comparison.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-800/60">
              {runs.map((run) => (
                <RunRow
                  key={run.timestamp}
                  run={run}
                  expanded={expanded.has(run.timestamp)}
                  selected={selected}
                  onToggle={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      next.has(run.timestamp)
                        ? next.delete(run.timestamp)
                        : next.add(run.timestamp);
                      return next;
                    })
                  }
                  onSelect={(provider) => selectProvider(run.timestamp, provider)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-zinc-800 px-4 py-2">
          <span className="text-[10px] font-mono text-zinc-700">
            {runs.length} run{runs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 flex flex-col min-w-0">
        <ContentPanel
          run={selectedRun}
          provider={selected?.provider ?? null}
          content={content}
          loading={contentLoading}
        />
      </main>

      {/* Markdown prose styles scoped via global */}
      <style>{`
        .prose-benchmark {
          color: #d4d4d8;
          line-height: 1.7;
          font-size: 14px;
        }
        .prose-benchmark h1 {
          font-size: 1.375rem;
          font-weight: 600;
          color: #e4e4e7;
          margin: 0 0 1rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #27272a;
          letter-spacing: -0.01em;
        }
        .prose-benchmark h2 {
          font-size: 1.05rem;
          font-weight: 600;
          color: #d4d4d8;
          margin: 1.75rem 0 0.5rem;
          letter-spacing: -0.01em;
        }
        .prose-benchmark h3 {
          font-size: 0.9rem;
          font-weight: 600;
          color: #a1a1aa;
          margin: 1.25rem 0 0.4rem;
        }
        .prose-benchmark p {
          margin: 0 0 0.75rem;
          color: #a1a1aa;
        }
        .prose-benchmark code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.8125rem;
          background: #18181b;
          color: #86efac;
          padding: 0.1em 0.35em;
          border-radius: 3px;
          border: 1px solid #27272a;
        }
        .prose-benchmark pre {
          background: #111113;
          border: 1px solid #27272a;
          border-radius: 6px;
          padding: 1rem 1.25rem;
          overflow-x: auto;
          margin: 0.75rem 0 1rem;
        }
        .prose-benchmark pre code {
          background: none;
          border: none;
          padding: 0;
          color: #d4d4d8;
          font-size: 0.8125rem;
        }
        .prose-benchmark ul, .prose-benchmark ol {
          padding-left: 1.5rem;
          margin: 0 0 0.75rem;
          color: #a1a1aa;
        }
        .prose-benchmark li {
          margin: 0.2rem 0;
        }
        .prose-benchmark hr {
          border: none;
          border-top: 1px solid #27272a;
          margin: 1.5rem 0;
        }
        .prose-benchmark blockquote {
          border-left: 3px solid #3f3f46;
          margin: 0.75rem 0;
          padding: 0.25rem 0 0.25rem 1rem;
          color: #71717a;
          font-style: italic;
        }
        .prose-benchmark table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8125rem;
          margin: 0.75rem 0 1rem;
        }
        .prose-benchmark th {
          text-align: left;
          padding: 0.4rem 0.75rem;
          background: #18181b;
          color: #a1a1aa;
          font-weight: 600;
          border-bottom: 1px solid #27272a;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .prose-benchmark td {
          padding: 0.4rem 0.75rem;
          border-bottom: 1px solid #1c1c1f;
          color: #a1a1aa;
        }
        .prose-benchmark tr:last-child td {
          border-bottom: none;
        }
        .prose-benchmark strong {
          color: #d4d4d8;
          font-weight: 600;
        }
        .prose-benchmark a {
          color: #6ee7b7;
          text-decoration: underline;
          text-decoration-color: #3f3f46;
        }
      `}</style>
    </div>
  );
}
