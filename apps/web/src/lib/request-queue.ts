export interface QueuedRequest {
  id: string;
  text: string;
  createdAt: string;
}

export function addQueuedRequest(
  queue: QueuedRequest[],
  text: string,
  createId: () => string = () => crypto.randomUUID(),
): QueuedRequest[] {
  const normalized = text.trim();
  if (!normalized) return queue;
  return [...queue, { id: createId(), text: normalized, createdAt: new Date().toISOString() }];
}

export function moveQueuedRequest(
  queue: QueuedRequest[],
  id: string,
  offset: -1 | 1,
): QueuedRequest[] {
  const currentIndex = queue.findIndex((item) => item.id === id);
  const targetIndex = currentIndex + offset;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= queue.length) return queue;
  const next = [...queue];
  [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
  return next;
}

export function removeQueuedRequest(queue: QueuedRequest[], id: string): QueuedRequest[] {
  return queue.filter((item) => item.id !== id);
}
