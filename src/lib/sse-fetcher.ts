import { useJobStore } from '../store/job-store';

export async function fetchEventStream(
  url: string,
  options: RequestInit,
  pageId: string | null = null,
  onChunk?: (text: string) => void
): Promise<string> {
  const reqBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
  reqBody.async_mode = true;
  options.body = JSON.stringify(reqBody);

  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  const { job_id } = await res.json();
  
  if (pageId) {
    useJobStore.getState().setJob(pageId, job_id);
  }

  // 5분(300s) 프론트엔드 타임아웃 — 백엔드가 complete/error를 보내지 못하고
  // hang하는 경우 무한 대기하지 않도록 강제 resolve.
  const FRONTEND_TIMEOUT_MS = 5 * 60 * 1000;

  return new Promise((resolve, reject) => {
    let fullText = '';
    let completed = false;
    const evtSource = new EventSource(`/api/task-streams/${job_id}/stream`);

    const cleanup = (resolveOrReject: 'resolve' | 'reject', reason?: string) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      evtSource.close();
      if (pageId) useJobStore.getState().removeJob(pageId);
      if (resolveOrReject === 'resolve') {
        resolve(fullText);
      } else {
        reject(new Error(reason || 'Stream error'));
      }
    };

    // 백엔드가 complete를 안 보내도 5분 후 지금까지 받은 내용으로 resolve
    const timeoutId = setTimeout(() => {
      console.warn(`[sse-fetcher] job ${job_id} timed out after ${FRONTEND_TIMEOUT_MS / 1000}s — resolving with partial content`);
      cleanup('resolve');
    }, FRONTEND_TIMEOUT_MS);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const eventType = data.type as string;
        if (eventType === 'chunk') {
          fullText += (data.data?.content || '');
          if (onChunk) onChunk(data.data?.content || '');
        } else if (eventType === 'complete') {
          cleanup('resolve');
        } else if (eventType === 'error') {
          cleanup('reject', data.message || 'Stream error');
        }
      } catch (err) {
        // parse error — ignore
      }
    };

    // The backend sends *named* SSE events (event: chunk / complete / error / heartbeat).
    // `onmessage` only fires for un-named events, so we must use addEventListener.
    evtSource.addEventListener('chunk', handleEvent);
    evtSource.addEventListener('complete', handleEvent);
    evtSource.addEventListener('error', handleEvent);
    // Also handle unnamed messages just in case
    evtSource.onmessage = handleEvent;

    evtSource.onerror = () => {
      // Only reject if we haven't already successfully completed
      cleanup('reject', 'EventSource connection lost');
    };
  });
}
