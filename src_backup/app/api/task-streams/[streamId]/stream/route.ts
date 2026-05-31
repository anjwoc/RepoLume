import { NextRequest, NextResponse } from 'next/server';

const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:8001';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await context.params;
  const targetUrl = new URL(`${TARGET_SERVER_BASE_URL}/task-streams/${encodeURIComponent(streamId)}/stream`);
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const headers = new Headers({
    Accept: 'text/event-stream',
  });
  const lastEventId = request.headers.get('Last-Event-ID');
  if (lastEventId) {
    headers.set('Last-Event-ID', lastEventId);
  }

  const backendResponse = await fetch(targetUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });

  if (!backendResponse.body) {
    return new NextResponse('Task stream body is empty', { status: 502 });
  }

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      'Content-Type': backendResponse.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
