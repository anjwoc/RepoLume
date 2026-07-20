import { NextResponse } from 'next/server';

const TARGET_SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:8001';

// Reports whether semantic wiki search (Ollama embeddings) is usable, so the UI can guide
// the user to install Ollama before enabling 정밀 검색.
export async function GET() {
  try {
    const res = await fetch(`${TARGET_SERVER_BASE_URL}/wiki/rag/health`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return NextResponse.json({ available: false, model: 'nomic-embed-text' });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // Backend or Ollama unreachable → treat as unavailable.
    return NextResponse.json({ available: false, model: 'nomic-embed-text' });
  }
}
