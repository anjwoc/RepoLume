import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { buildScenarioJobItems, flowDocumentFileName } from '@/lib/test-scenario-job-builder';
import type { CatalogFlow } from '@/lib/test-scenario-types';

const BACKEND = process.env.SERVER_BASE_URL || process.env.PYTHON_BACKEND_HOST || 'http://localhost:8001';

function validateFlows(rawFlows: Record<string, unknown>[]): CatalogFlow[] {
  return rawFlows.map((flow) => ({
    id: String(flow.id ?? ''),
    name: String(flow.name ?? ''),
    repos: (flow.repos as string[]) ?? [],
    entryClasses: (flow.entryClasses as string[]) ?? [],
    tables: ((flow.tables as Record<string, unknown>[]) ?? []).map((table) => ({
      name: String(table.name ?? ''),
      db: String(table.db ?? ''),
    })),
    codeRefs: ((flow.codeRefs as Record<string, unknown>[]) ?? []).map((codeRef) => ({
      host: String(codeRef.host ?? ''),
      repo: String(codeRef.repo ?? ''),
      path: String(codeRef.path ?? ''),
    })),
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sourcePath = String(body.sourcePath ?? '');
    const artifactRoot = String(body.artifactRoot ?? body.wikiOutDir ?? '');
    const streamId = String(body.streamId ?? '');
    const catalogFlows = validateFlows(body.catalogFlows ?? []);
    const flowIds = Array.isArray(body.flowIds) ? body.flowIds.map(String) : [];

    if (!path.isAbsolute(sourcePath) || !path.isAbsolute(artifactRoot) || !streamId || catalogFlows.length === 0) {
      return NextResponse.json(
        { error: 'sourcePath, artifactRoot, streamId, and catalogFlows are required' },
        { status: 400 },
      );
    }
    if (path.resolve(sourcePath) === path.resolve(artifactRoot)) {
      return NextResponse.json({ error: 'Source and artifact paths must be different' }, { status: 400 });
    }

    const selectedFlows = flowIds.length
      ? catalogFlows.filter((flow) => flowIds.includes(flow.id))
      : catalogFlows;
    const flowDocuments: Record<string, string> = {};
    const missingFlowIds: string[] = [];
    await Promise.all(selectedFlows.map(async (flow) => {
      const documentPath = path.join(artifactRoot, 'business-flows', flowDocumentFileName(flow));
      try {
        flowDocuments[flow.id] = await readFile(documentPath, 'utf-8');
      } catch {
        missingFlowIds.push(flow.id);
      }
    }));

    if (missingFlowIds.length > 0) {
      return NextResponse.json(
        { error: 'Business flow documents are missing', missingFlowIds: missingFlowIds.sort() },
        { status: 422 },
      );
    }

    let debuggingContext = '';
    try {
      debuggingContext = await readFile(
        path.join(artifactRoot, 'system_analysis', 'debugging_flow.md'),
        'utf-8',
      );
    } catch {
      debuggingContext = '';
    }

    const built = buildScenarioJobItems({
      catalogFlows,
      flowDocuments,
      debuggingContext,
      flowIds,
    });
    if (built.items.length === 0 || built.missingFlowIds.length > 0) {
      return NextResponse.json(
        { error: 'No complete test scenario inputs were built', missingFlowIds: built.missingFlowIds },
        { status: 422 },
      );
    }

    const backendResponse = await fetch(`${BACKEND}/api/test-scenarios/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stream_id: streamId,
        source_path: sourcePath,
        artifact_root: artifactRoot,
        provider: body.provider ?? 'google',
        model: body.model ?? null,
        use_cli: body.mode !== 'api',
        cli_tool: body.cliTool ?? null,
        api_key: body.apiKey ?? null,
        language: body.language ?? 'ko',
        items: built.items,
      }),
    });
    const responseBody = await backendResponse.json().catch(() => ({ error: backendResponse.statusText }));
    return NextResponse.json(responseBody, { status: backendResponse.status });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId');
  if (jobId) {
    const response = await fetch(`${BACKEND}/api/test-scenarios/jobs/${encodeURIComponent(jobId)}`, {
      cache: 'no-store',
    });
    const body = await response.json().catch(() => ({ error: response.statusText }));
    return NextResponse.json(body, { status: response.status });
  }

  const artifactRoot = request.nextUrl.searchParams.get('artifactRoot')
    ?? request.nextUrl.searchParams.get('wikiOutDir');
  if (!artifactRoot || !path.isAbsolute(artifactRoot)) {
    return NextResponse.json({ error: 'jobId or artifactRoot is required' }, { status: 400 });
  }
  try {
    const [indexContent, manifestContent] = await Promise.all([
      readFile(path.join(artifactRoot, 'test-scenarios', '_index.md'), 'utf-8'),
      readFile(path.join(artifactRoot, 'test-scenarios', 'manifest.json'), 'utf-8'),
    ]);
    const manifest = JSON.parse(manifestContent);
    const documents: Record<string, string> = {};
    await Promise.all((manifest.results ?? []).map(async (result: { output_file?: string; status?: string }) => {
      if (result.status !== 'succeeded' || !result.output_file || path.basename(result.output_file) !== result.output_file) {
        return;
      }
      documents[result.output_file] = await readFile(
        path.join(artifactRoot, 'test-scenarios', result.output_file),
        'utf-8',
      );
    }));
    return NextResponse.json({
      ok: true,
      hasScenarios: true,
      indexContent,
      manifest,
      documents,
    });
  } catch {
    return NextResponse.json({ ok: true, hasScenarios: false, indexContent: null, manifest: null });
  }
}
