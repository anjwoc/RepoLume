import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.PYTHON_BACKEND_HOST || 'http://localhost:8001';

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.toString();
  try {
    const res = await fetch(`${BACKEND}/api/wiki/cache-status?${search}`, { cache: 'no-store' });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ exists: false }, { status: 503 });
  }
}
