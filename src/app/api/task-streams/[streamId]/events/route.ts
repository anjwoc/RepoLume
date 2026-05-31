import { NextRequest, NextResponse } from 'next/server';

const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:8001';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ streamId: string }> }
) {
  const { streamId } = await context.params;
  const body = await request.text();

  const backendResponse = await fetch(
    `${TARGET_SERVER_BASE_URL}/task-streams/${encodeURIComponent(streamId)}/events`,
    {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('Content-Type') || 'application/json',
        Accept: 'application/json',
      },
      body,
    }
  );

  const responseText = await backendResponse.text();
  return new NextResponse(responseText, {
    status: backendResponse.status,
    headers: {
      'Content-Type': backendResponse.headers.get('Content-Type') || 'application/json',
    },
  });
}
