import { describe, expect, it } from 'vitest';

import { addQueuedRequest, moveQueuedRequest, removeQueuedRequest } from '../request-queue';

describe('request queue operations', () => {
  it('adds non-empty requests and ignores whitespace', () => {
    const first = addQueuedRequest([], '  목차를 더 간결하게  ', () => 'q1');
    expect(first).toEqual([{ id: 'q1', text: '목차를 더 간결하게', createdAt: expect.any(String) }]);
    expect(addQueuedRequest(first, '   ', () => 'q2')).toEqual(first);
  });

  it('reorders without moving beyond queue bounds', () => {
    const queue = [
      { id: 'a', text: 'A', createdAt: '1' },
      { id: 'b', text: 'B', createdAt: '2' },
      { id: 'c', text: 'C', createdAt: '3' },
    ];
    expect(moveQueuedRequest(queue, 'b', -1).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(moveQueuedRequest(queue, 'a', -1)).toEqual(queue);
  });

  it('removes only the selected request', () => {
    const queue = [
      { id: 'a', text: 'A', createdAt: '1' },
      { id: 'b', text: 'B', createdAt: '2' },
    ];
    expect(removeQueuedRequest(queue, 'a').map((item) => item.id)).toEqual(['b']);
  });
});
