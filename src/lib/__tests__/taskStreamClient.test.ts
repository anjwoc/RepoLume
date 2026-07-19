import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchContent } from '../taskStreamClient';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  readyState = FakeEventSource.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  listeners = new Map<string, Array<(event: Event) => void>>();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, payload: object) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('fetchContent reconnect behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it('keeps waiting during a transient EventSource reconnect', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'job-1' }),
    }));

    let settled = false;
    const result = fetchContent('/api/chat/stream', {}).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    source.readyState = FakeEventSource.CONNECTING;
    source.onerror?.({} as Event);
    await Promise.resolve();
    expect(settled).toBe(false);

    source.emit('complete', {
      id: 2,
      type: 'complete',
      stream_id: 'job-1',
      ts: new Date().toISOString(),
      message: 'done',
      data: {},
    });
    await expect(result).resolves.toBe('');
  });

  it('reconnects with the last event id when durable progress is not delivered', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/health')) {
        return {
          ok: true,
          json: async () => ({
            last_persisted_seq: 2,
            job_status: 'running',
            background_running: true,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ job_id: 'job-1' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = fetchContent('/api/chat/stream', {}, {
      healthIntervalMs: 10,
      stallThresholdMs: 0,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0].emit('agent.chunk', {
      id: 1,
      type: 'agent.chunk',
      stream_id: 'job-1',
      ts: new Date().toISOString(),
      message: 'first',
      data: { text: 'first' },
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toContain('last_event_id=1');

    FakeEventSource.instances[1].emit('complete', {
      id: 2,
      type: 'complete',
      stream_id: 'job-1',
      ts: new Date().toISOString(),
      message: 'done',
      data: {},
    });
    await expect(result).resolves.toBe('first');
  });

  it('cancels the backend job when the caller aborts', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'job-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const result = fetchContent('/api/chat/stream', {}, { signal: controller.signal });
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/task-streams/job-1/cancel',
      expect.objectContaining({ method: 'POST', keepalive: true })
    );
  });
});
