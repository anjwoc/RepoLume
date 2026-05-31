'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaCheckCircle, FaChevronDown, FaChevronRight, FaCircle, FaExclamationTriangle, FaTerminal } from 'react-icons/fa';
import { createTaskStream, TaskStreamEvent } from '@/utils/taskStreamClient';

const VISIBLE_TYPES = ['task_status', 'phase_start', 'phase_complete', 'page_start', 'page_complete', 'agent_log', 'error', 'complete'];

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function TaskLogPanel({
  streamId,
  initiallyOpen = true,
  className = '',
}: {
  streamId?: string;
  initiallyOpen?: boolean;
  className?: string;
}) {
  const [events, setEvents] = useState<TaskStreamEvent[]>([]);
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => new Set(VISIBLE_TYPES));
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!streamId) return;
    setEvents([]);
    const source = createTaskStream(streamId, {
      onEvent: (event) => {
        if (event.type === 'heartbeat') return;
        setEvents((prev) => {
          if (prev.some((item) => item.id === event.id && item.stream_id === event.stream_id)) return prev;
          return [...prev.slice(-299), event];
        });
      },
    });
    return () => source.close();
  }, [streamId]);

  useEffect(() => {
    if (isOpen) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [events, isOpen]);

  const visibleEvents = useMemo(
    () => events.filter((event) => selectedTypes.has(event.type)),
    [events, selectedTypes]
  );

  const phaseSummary = useMemo(() => {
    const summary = new Map<string, { total: number; errors: number; complete: boolean }>();
    events.forEach((event) => {
      const phase = event.phase || 'task';
      const current = summary.get(phase) || { total: 0, errors: 0, complete: false };
      current.total += event.type === 'heartbeat' ? 0 : 1;
      current.errors += event.type === 'error' ? 1 : 0;
      current.complete = current.complete || event.type === 'phase_complete' || event.type === 'complete';
      summary.set(phase, current);
    });
    return Array.from(summary.entries()).slice(-4);
  }, [events]);

  const latest = events[events.length - 1];

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className={`w-full border border-[var(--border-color)] rounded-lg bg-[var(--card-bg)] overflow-hidden text-left shadow-sm ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          {isOpen ? <FaChevronDown className="text-xs" /> : <FaChevronRight className="text-xs" />}
          <FaTerminal className="text-[var(--accent-primary)]" />
          Task trace
        </span>
        <span className="min-w-0 flex-1 text-right text-xs text-[var(--muted)] truncate">
          {latest ? latest.message : 'Waiting for events...'}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-[var(--border-color)]">
          {phaseSummary.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3 border-b border-[var(--border-color)] bg-[var(--surface)]">
              {phaseSummary.map(([phase, item]) => (
                <div key={phase} className="rounded-md border border-[var(--border-color)] bg-[var(--card-bg)] px-3 py-2 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
                    {item.errors > 0 ? (
                      <FaExclamationTriangle className="text-[var(--highlight)]" />
                    ) : item.complete ? (
                      <FaCheckCircle className="text-[var(--success)]" />
                    ) : (
                      <FaCircle className="text-[7px] text-[var(--accent-primary)]" />
                    )}
                    <span className="truncate">{phase}</span>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                    {item.errors > 0 ? `${item.errors} errors` : `${item.total} events`}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-[var(--border-color)]">
            {VISIBLE_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                  selectedTypes.has(type)
                    ? 'border-[var(--accent-primary)] text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                    : 'border-[var(--border-color)] text-[var(--muted)]'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="max-h-[360px] overflow-y-auto px-4 py-3 font-mono text-xs">
            {visibleEvents.length === 0 ? (
              <div className="text-[var(--muted)]">No log events yet.</div>
            ) : (
              <div className="space-y-2">
                {visibleEvents.map((event) => (
                  <div
                    key={`${event.stream_id}-${event.id}-${event.type}`}
                    className={`grid grid-cols-[68px_minmax(88px,112px)_1fr] gap-2 items-start ${
                      event.type === 'error' ? 'text-[var(--highlight)]' : 'text-[var(--foreground)]'
                    }`}
                  >
                    <span className="text-[var(--muted)]">{formatTime(event.ts)}</span>
                    <span className="flex items-center gap-1 truncate">
                      {event.type === 'error' ? <FaExclamationTriangle /> : <FaCircle className="text-[6px]" />}
                      {event.type}
                    </span>
                    <span className="break-words">
                      {event.phase && <span className="text-[var(--muted)]">[{event.phase}] </span>}
                      {event.message || JSON.stringify(event.data)}
                    </span>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
