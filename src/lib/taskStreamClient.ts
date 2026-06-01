export type TaskEventType =
  | 'task_status'
  | 'phase_start'
  | 'phase_complete'
  | 'page_start'
  | 'page_complete'
  | 'agent_log'
  | 'error'
  | 'complete'
  | 'heartbeat';

export interface TaskStreamEvent {
  id: number;
  type: TaskEventType | string;
  stream_id: string;
  ts: string;
  phase?: string | null;
  message: string;
  data: Record<string, unknown>;
}

export interface TaskStreamHandlers {
  onEvent?: (event: TaskStreamEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

const EVENT_TYPES: TaskEventType[] = [
  'task_status',
  'phase_start',
  'phase_complete',
  'page_start',
  'page_complete',
  'agent_log',
  'error',
  'complete',
  'heartbeat',
];

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

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (message) => {
      try {
        handlers.onEvent?.(JSON.parse((message as MessageEvent).data));
      } catch {
        handlers.onEvent?.({
          id: 0,
          type,
          stream_id: streamId,
          ts: new Date().toISOString(),
          message: (message as MessageEvent).data,
          data: {},
        });
      }
    });
  }

  return source;
}

export async function emitTaskEvent(
  streamId: string | undefined,
  event: {
    type: TaskEventType | string;
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
        message: event.message || '',
        data: event.data || {},
      }),
    });
  } catch (error) {
    console.warn('Failed to emit task event:', error);
  }
}
