import { NextRequest, NextResponse } from 'next/server';

// Backend server base URL (matches /api/chat/stream proxy).
const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:8001';

// Proxy for the Wiki RAG (P3) semantic Q&A endpoint. Streams the backend response through.
export async function POST(req: NextRequest) {
  try {
    const requestBody = await req.json();
    const targetUrl = `${TARGET_SERVER_BASE_URL}/wiki/ask/stream`;

    const backendResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(requestBody),
    });

    if (!backendResponse.ok) {
      const errorBody = await backendResponse.text();
      const errorHeaders = new Headers();
      backendResponse.headers.forEach((value, key) => errorHeaders.set(key, value));
      return new NextResponse(errorBody, {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        headers: errorHeaders,
      });
    }

    if (!backendResponse.body) {
      return new NextResponse('Stream body from backend is null', { status: 500 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const reader = backendResponse.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (error) {
          console.error('Error reading from backend stream in wiki-ask proxy:', error);
          controller.error(error);
        } finally {
          controller.close();
          reader.releaseLock();
        }
      },
      cancel(reason) {
        console.log('Client cancelled wiki-ask stream request:', reason);
      },
    });

    const responseHeaders = new Headers();
    const contentType = backendResponse.headers.get('Content-Type');
    if (contentType) responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Cache-Control', 'no-cache, no-transform');

    return new NextResponse(stream, { status: backendResponse.status, headers: responseHeaders });
  } catch (error) {
    console.error('Error in API proxy route (/api/wiki/ask/stream):', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal Server Error in proxy';
    return new NextResponse(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
