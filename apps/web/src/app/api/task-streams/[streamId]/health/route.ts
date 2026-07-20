import { NextResponse } from 'next/server';

const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:8001';

export async function GET(
  _request: Request,
  context: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await context.params;
  const backendResponse = await fetch(
    `${TARGET_SERVER_BASE_URL}/task-streams/${encodeURIComponent(streamId)}/health`,
    {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }
  );
  const responseText = await backendResponse.text();
  return new NextResponse(responseText, {
    status: backendResponse.status,
    headers: {
      'Content-Type': backendResponse.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
