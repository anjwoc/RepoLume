import { describe, expect, it } from 'vitest';

import type { PipelineEvent } from '../event-types';
import { projectConversationEvents } from '../conversation-events';

function event(id: number, type: string, overrides: Partial<PipelineEvent> = {}): PipelineEvent {
  return {
    id,
    type,
    stream_id: 'job-1',
    ts: `2026-07-19T00:00:0${id}.000Z`,
    message: type,
    data: {},
    ...overrides,
  };
}

describe('conversation event projection', () => {
  it('deduplicates replayed events and restores canonical event order', () => {
    const projected = projectConversationEvents([
      event(3, 'page.completed', { message: 'Overview created', data: { path: 'overview.md' } }),
      event(1, 'pipeline.started', { message: 'Analysis started' }),
      event(2, 'phase.started', { phase: 'structure', message: 'Planning structure' }),
      event(2, 'phase.started', { phase: 'structure', message: 'Planning structure' }),
    ]);

    expect(projected.map((item) => item.eventId)).toEqual([1, 2, 3]);
    expect(projected.map((item) => item.kind)).toEqual(['plan', 'progress', 'artifact']);
  });

  it('maps approval, terminal failure, and completion without projecting heartbeats or chunks', () => {
    const projected = projectConversationEvents([
      event(1, 'heartbeat'),
      event(2, 'agent.chunk'),
      event(3, 'structure.preview', { data: { page_count: 8, section_count: 3 } }),
      event(4, 'error', { message: 'provider timed out' }),
      event(5, 'complete', { message: 'finished' }),
    ]);

    expect(projected.map((item) => item.kind)).toEqual(['approval', 'error', 'complete']);
    expect(projected[0].data).toMatchObject({ page_count: 8, section_count: 3 });
  });

  it('merges a reconnect replay into existing projection without duplicates', () => {
    const initial = projectConversationEvents([event(1, 'pipeline.started')]);
    const replayed = projectConversationEvents(
      [event(1, 'pipeline.started'), event(2, 'task.warning', { message: 'one flow failed' })],
      initial,
    );

    expect(replayed).toHaveLength(2);
    expect(replayed[1].kind).toBe('warning');
  });
});
