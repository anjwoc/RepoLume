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

  return new Promise((resolve, reject) => {
    let fullText = '';
    let completed = false;
    const evtSource = new EventSource(`/api/task-streams/${job_id}/stream`);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const eventType = data.type as string;
        if (eventType === 'chunk') {
          fullText += (data.data?.content || '');
          if (onChunk) onChunk(data.data?.content || '');
        } else if (eventType === 'complete') {
          completed = true;
          evtSource.close();
          if (pageId) useJobStore.getState().removeJob(pageId);
          resolve(fullText);
        } else if (eventType === 'error') {
          evtSource.close();
          if (pageId) useJobStore.getState().removeJob(pageId);
          reject(new Error(data.message || 'Stream error'));
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
      evtSource.close();
      if (pageId) useJobStore.getState().removeJob(pageId);
      // Only reject if we haven't already successfully completed
      if (!completed) {
        reject(new Error('EventSource connection lost'));
      }
    };
  });
}
