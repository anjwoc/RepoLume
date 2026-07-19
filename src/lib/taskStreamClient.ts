import { EventType, PipelineEvent, PhaseType } from './event-types';

export type { EventType, PhaseType, PipelineEvent };

// Legacy event type strings emitted by the current backend (pre-refactor).
// Kept for backward compat during migration — remove after Phase 2 backend update.
const LEGACY_EVENT_TYPES = [
  'task_status',
  'phase_start',
  'phase_complete',
  'page_start',
  'page_complete',
  'agent_log',
] as const;

// Canonical event types (post-refactor)
const CANONICAL_EVENT_TYPES = Object.values(EventType);

export interface TaskStreamHandlers {
  onEvent?: (event: PipelineEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

interface TaskStreamHealth {
  last_persisted_seq: number;
  job_status: string | null;
  background_running: boolean;
}

const DEFAULT_HEALTH_INTERVAL_MS = 15_000;
const DEFAULT_STALL_THRESHOLD_MS = 30_000;

export function createTaskStream(
  streamId: string,
  handlers: TaskStreamHandlers,
  options?: { events?: string[]; lastEventId?: number }
): EventSource {
  const params = new URLSearchParams();
  if (options?.events?.length) {
    params.set('events', options.events.join(','));
  }
  if (options?.lastEventId && options.lastEventId > 0) {
    params.set('last_event_id', String(options.lastEventId));
  }
  const suffix = params.toString() ? `?${params}` : '';
  const source = new EventSource(`/api/task-streams/${encodeURIComponent(streamId)}/stream${suffix}`);

  source.onopen = () => handlers.onOpen?.();
  source.onerror = (error) => handlers.onError?.(error);

  const handleMessage = (type: string) => (message: Event) => {
    try {
      handlers.onEvent?.(JSON.parse((message as MessageEvent).data));
    } catch {
      handlers.onEvent?.({
        id: 0,
        type: type as EventType,
        stream_id: streamId,
        ts: new Date().toISOString(),
        message: (message as MessageEvent).data,
        data: {},
      });
    }
  };

  for (const type of CANONICAL_EVENT_TYPES) {
    source.addEventListener(type, handleMessage(type));
  }
  for (const type of LEGACY_EVENT_TYPES) {
    source.addEventListener(type, handleMessage(type));
  }

  return source;
}

export async function emitTaskEvent(
  streamId: string | undefined,
  event: {
    type: EventType | string;
    phase?: string;
    message?: string;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  if (!streamId) return;
  try {
    await fetch(`/api/task-streams/${encodeURIComponent(streamId)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: event.type,
        phase: event.phase,
        message: event.message ?? '',
        data: event.data ?? {},
      }),
    });
  } catch (error) {
    console.warn('Failed to emit task event:', error);
  }
}

/**
 * POST to url with async_mode=true, subscribe to the returned job_id SSE stream,
 * accumulate agent.chunk / chunk events, resolve on complete.
 * Replaces sse-fetcher.ts fetchEventStream.
 */
export async function fetchContent(
  url: string,
  body: Record<string, unknown>,
  options?: {
    pageId?: string | null;
    onChunk?: (text: string) => void;
    signal?: AbortSignal;
    healthIntervalMs?: number;
    stallThresholdMs?: number;
  }
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, async_mode: true, task_id: options?.pageId ?? 'chat' }),
    signal: options?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`fetchContent: HTTP ${res.status} — ${text}`);
  }

  const { job_id } = await res.json();
  if (!job_id) throw new Error('fetchContent: no job_id in response');

  return new Promise<string>((resolve, reject) => {
    const accumulated: string[] = [];
    const healthIntervalMs = options?.healthIntervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
    const stallThresholdMs = options?.stallThresholdMs ?? DEFAULT_STALL_THRESHOLD_MS;
    let source: EventSource | null = null;
    let lastEventId = 0;
    let lastEventAt = Date.now();
    let settled = false;
    let watchdogInFlight = false;
    let watchdogTimer: ReturnType<typeof setInterval> | null = null;
    let abortHandler: (() => void) | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (watchdogTimer) clearInterval(watchdogTimer);
      source?.close();
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      if (error) reject(error);
      else resolve(accumulated.join(''));
    };

    const connect = () => {
      let nextSource: EventSource;
      nextSource = createTaskStream(job_id, {
        onEvent(event) {
          if (source !== nextSource || settled) return;
          lastEventAt = Date.now();
          if (event.id > 0) lastEventId = Math.max(lastEventId, event.id);
          if (
            event.type === EventType.AGENT_CHUNK ||
            event.type === 'agent_log' ||
            event.type === 'chunk'
          ) {
            const text =
              (event.data?.text as string) ??
              (event.data?.content as string) ??
              event.message ??
              '';
            accumulated.push(text);
            options?.onChunk?.(text);
          } else if (event.type === EventType.COMPLETE || event.type === 'complete') {
            finish();
          } else if (event.type === EventType.ERROR || event.type === 'error') {
            finish(new Error(event.message || 'Stream error'));
          }
        },
        onError() {
          if (source === nextSource && nextSource.readyState === EventSource.CLOSED) {
            finish(new Error('SSE connection closed before a terminal event'));
          }
        },
      }, { lastEventId });
      source = nextSource;
    };

    connect();

    watchdogTimer = setInterval(() => {
      if (settled || watchdogInFlight) return;
      watchdogInFlight = true;
      void fetch(`/api/task-streams/${encodeURIComponent(job_id)}/health`, {
        cache: 'no-store',
      })
        .then(async (healthResponse) => {
          if (!healthResponse.ok) return null;
          return healthResponse.json() as Promise<TaskStreamHealth>;
        })
        .then((health) => {
          if (
            !health ||
            !Number.isFinite(health.last_persisted_seq) ||
            health.last_persisted_seq <= lastEventId ||
            Date.now() - lastEventAt < stallThresholdMs
          ) {
            return;
          }
          const previous = source;
          connect();
          previous?.close();
        })
        .catch(() => undefined)
        .finally(() => {
          watchdogInFlight = false;
        });
    }, healthIntervalMs);

    if (options?.signal) {
      abortHandler = () => {
        void fetch(`/api/task-streams/${encodeURIComponent(job_id)}/cancel`, {
          method: 'POST',
          keepalive: true,
        });
        finish(new DOMException('Aborted', 'AbortError'));
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
      if (options.signal.aborted) abortHandler();
    }
  });
}
