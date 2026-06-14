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

export function createTaskStream(
  streamId: string,
  handlers: TaskStreamHandlers,
  options?: { events?: string[] }
): EventSource {
  const params = new URLSearchParams();
  if (options?.events?.length) {
    params.set('events', options.events.join(','));
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
  }
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, async_mode: true }),
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

    const es = createTaskStream(job_id, {
      onEvent(event) {
        // Accept both canonical (agent.chunk) and legacy (agent_log / chunk)
        if (
          event.type === EventType.AGENT_CHUNK ||
          event.type === 'agent_log' ||
          event.type === 'chunk'
        ) {
          // data.text (canonical) → data.content (legacy background_task) → message
          const text =
            (event.data?.text as string) ??
            (event.data?.content as string) ??
            event.message ??
            '';
          accumulated.push(text);
          options?.onChunk?.(text);
        } else if (event.type === EventType.COMPLETE || event.type === 'complete') {
          es.close();
          resolve(accumulated.join(''));
        } else if (event.type === EventType.ERROR || event.type === 'error') {
          es.close();
          reject(new Error(event.message || 'Stream error'));
        }
      },
      onError() {
        es.close();
        reject(new Error('SSE connection error'));
      },
    });

    // AbortSignal 연동 — 워커 타임아웃 시 SSE 즉시 닫기
    if (options?.signal) {
      options.signal.addEventListener('abort', () => {
        es.close();
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}
