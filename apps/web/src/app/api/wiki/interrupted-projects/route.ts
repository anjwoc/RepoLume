import { NextResponse } from 'next/server';

const BACKEND = process.env.PYTHON_BACKEND_HOST || 'http://localhost:8001';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND}/api/wiki/interrupted-projects`, { cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json([], { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([], { status: 503 });
  }
}
