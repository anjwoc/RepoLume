// ─── Test Scenario Generator ────────────────────────────────────────────────
// Orchestrates wiki parsing → cross-flow analysis → LLM prompt → output.
// Follows the same SSE event pattern as runWikiGeneration() in wiki-generator.ts.

import { emitTaskEvent, fetchContent } from './taskStreamClient';
import { EventType } from './event-types';
import { parseFlowDocument, parseDebuggingFlow } from './wiki-test-parser';
import { detectCrossFlowDependencies, buildFlowChains, generateDependencyDiagram } from './cross-flow-analyzer';
import { buildTestPrompt, buildCrossFlowTestPrompt } from './build-test-prompt';
import { normalizeMarkdownContent } from './markdown-normalize';
import type {
  CatalogFlow,
  ParsedFlowDocument,
  FlowDependency,
  FlowChain,
  TestGenPhase,
  TestGenProgress,
  TestGenerationResult,
} from './test-scenario-types';

// ── Public API ──────────────────────────────────────────────────────────────

export interface TestGenerationOptions {
  /** wiki-out directory path (e.g., wiki-out/affiliate_agy-gemini-3.5-flash-high) */
  wikiOutDir: string;
  /** Specific flow IDs to generate (empty = all flows) */
  flowIds?: string[];
  /** Stream ID for SSE progress events */
  streamId: string;
  /** LLM provider */
  provider?: string;
  /** LLM model */
  model?: string;
  /** API key (optional if using default) */
  apiKey?: string;
  /** catalog.yaml parsed flows */
  catalogFlows: CatalogFlow[];
  /** Stop signal for cancellation */
  stopSignal?: { stopped: boolean };
}

/**
 * Main entry point: generates test scenarios from wiki business flow documents.
 * Emits SSE events via streamId for real-time progress tracking.
 */
export async function generateTestScenarios(options: TestGenerationOptions): Promise<TestGenerationResult[]> {
  const {
    wikiOutDir,
    flowIds,
    streamId,
    provider = 'google',
    model = 'gemini-2.5-flash',
    apiKey,
    catalogFlows,
    stopSignal,
  } = options;

  const results: TestGenerationResult[] = [];

  try {
    // ── Phase 1: Parsing ──────────────────────────────────────────────
    await emitProgress(streamId, 'parsing', '위키 문서 파싱 시작', 0);

    // Read business flow documents
    const targetFlows = flowIds?.length
      ? catalogFlows.filter(f => flowIds.includes(f.id))
      : catalogFlows;

    const parsedFlows: ParsedFlowDocument[] = [];
    for (let i = 0; i < targetFlows.length; i++) {
      if (stopSignal?.stopped) break;

      const flow = targetFlows[i];
      const flowFileName = buildFlowFileName(flow);
      const flowPath = `${wikiOutDir}/business-flows/${flowFileName}`;

      await emitProgress(
        streamId, 'parsing',
        `📄 ${flow.id}: ${flow.name} 파싱 중...`,
        Math.round((i / targetFlows.length) * 100)
      );

      try {
        const markdown = await readFileContent(flowPath);
        const parsed = parseFlowDocument(markdown, flow.id);
        parsedFlows.push(parsed);

        await emitLog(streamId, 'info',
          `${flow.id} 파싱 완료: ${parsed.participants.length} participants, ` +
          `${parsed.interactions.length} interactions, ${parsed.sqlSteps.length} SQL steps`
        );
      } catch (err) {
        await emitLog(streamId, 'warn', `${flow.id} 파싱 실패: ${err}`);
      }
    }

    // Read debugging flow for cross-cutting context
    let debuggingContext = '';
    try {
      debuggingContext = await readFileContent(`${wikiOutDir}/system_analysis/debugging_flow.md`);
      await emitLog(streamId, 'info', 'debugging_flow.md 로드 완료');
    } catch {
      await emitLog(streamId, 'warn', 'debugging_flow.md 없음 — 디버깅 컨텍스트 없이 진행');
    }

    // ── Phase 2: Cross-Flow Analysis ──────────────────────────────────
    if (stopSignal?.stopped) return results;
    await emitProgress(streamId, 'analyzing-cross-flow', '크로스 플로우 의존성 분석 중', 0);

    const crossFlowDeps = detectCrossFlowDependencies(catalogFlows);
    const flowChains = buildFlowChains(catalogFlows, crossFlowDeps);
    const depDiagram = generateDependencyDiagram(catalogFlows, crossFlowDeps);

    await emitLog(streamId, 'info',
      `크로스 플로우 분석 완료: ${crossFlowDeps.length}개 의존성, ${flowChains.length}개 체인 감지`
    );
    await emitProgress(streamId, 'analyzing-cross-flow', '크로스 플로우 분석 완료', 100);

    // ── Phase 3: Generate Test Scenarios per Flow ─────────────────────
    for (let i = 0; i < parsedFlows.length; i++) {
      if (stopSignal?.stopped) break;

      const parsed = parsedFlows[i];
      const catalogFlow = catalogFlows.find(f => f.id === parsed.flowId);
      if (!catalogFlow) continue;

      // Build prompt
      await emitProgress(
        streamId, 'building-prompt',
        `🔧 ${parsed.flowId} 테스트 프롬프트 생성 중...`,
        Math.round((i / parsedFlows.length) * 30)
      );

      const prompt = buildTestPrompt(
        parsed,
        catalogFlow,
        crossFlowDeps.filter(d => d.from === parsed.flowId || d.to === parsed.flowId),
        flowChains,
        debuggingContext
      );

      // LLM call
      await emitProgress(
        streamId, 'generating',
        `🤖 ${parsed.flowId} 테스트 시나리오 LLM 생성 중...`,
        Math.round(30 + (i / parsedFlows.length) * 50)
      );

      try {
        const generatedMarkdown = await fetchContent(
          '/api/chat',
          {
            provider,
            model,
            api_key: apiKey,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 8000,
          },
          {
            pageId: `test-${parsed.flowId}`,
            onChunk: (chunk) => {
              emitLog(streamId, 'debug', `${parsed.flowId} chunk: ${chunk.slice(0, 60)}...`);
            },
          }
        );

        const normalizedMarkdown = normalizeMarkdownContent(generatedMarkdown);

        results.push({
          flowId: parsed.flowId,
          flowName: parsed.flowName,
          scenarios: [], // Scenarios are embedded in the markdown
          crossFlowChains: flowChains.filter(c => c.flows.includes(parsed.flowId)),
          generatedAt: new Date().toISOString(),
          markdown: normalizedMarkdown,
        });

        await emitLog(streamId, 'info',
          `✅ ${parsed.flowId} 테스트 시나리오 생성 완료 (${normalizedMarkdown.length} chars)`
        );
      } catch (err) {
        await emitLog(streamId, 'error', `❌ ${parsed.flowId} 생성 실패: ${err}`);
      }
    }

    // ── Phase 4: Generate Cross-Flow Chain Scenarios ──────────────────
    if (!stopSignal?.stopped && flowChains.length > 0) {
      await emitProgress(streamId, 'generating', '🔗 크로스 플로우 체인 시나리오 생성 중...', 80);

      for (const chain of flowChains) {
        if (stopSignal?.stopped) break;

        const chainParsedFlows = parsedFlows.filter(p => chain.flows.includes(p.flowId));
        if (chainParsedFlows.length < 2) continue;

        const chainPrompt = buildCrossFlowTestPrompt(chain, chainParsedFlows, debuggingContext);

        try {
          const chainMarkdown = await fetchContent(
            '/api/chat',
            {
              provider,
              model,
              api_key: apiKey,
              messages: [{ role: 'user', content: chainPrompt }],
              temperature: 0.3,
              max_tokens: 6000,
            },
            { pageId: `test-chain-${chain.flows.join('-')}` }
          );

          const normalizedChainMd = normalizeMarkdownContent(chainMarkdown);

          results.push({
            flowId: `chain-${chain.flows.join('-')}`,
            flowName: chain.name,
            scenarios: [],
            crossFlowChains: [chain],
            generatedAt: new Date().toISOString(),
            markdown: normalizedChainMd,
          });

          await emitLog(streamId, 'info', `✅ 크로스 플로우 체인 "${chain.name}" 생성 완료`);
        } catch (err) {
          await emitLog(streamId, 'error', `❌ 체인 "${chain.name}" 생성 실패: ${err}`);
        }
      }
    }

    // ── Phase 5: Write Output Files ──────────────────────────────────
    if (!stopSignal?.stopped) {
      await emitProgress(streamId, 'writing-output', '📁 산출물 저장 중...', 90);

      for (const result of results) {
        const outputDir = result.flowId.startsWith('chain-')
          ? `${wikiOutDir}/test-scenarios`
          : `${wikiOutDir}/test-scenarios`;

        const fileName = result.flowId.startsWith('chain-')
          ? `cross-flow-${result.flowId.replace('chain-', '')}.md`
          : `${result.flowId.toLowerCase()}-test-guide.md`;

        try {
          await writeFileContent(`${outputDir}/${fileName}`, result.markdown);
          await emitLog(streamId, 'info', `📄 ${fileName} 저장 완료`);
        } catch (err) {
          await emitLog(streamId, 'warn', `⚠️ ${fileName} 저장 실패: ${err}`);
        }
      }

      // Write index file
      await writeTestIndex(wikiOutDir, results, crossFlowDeps, depDiagram);
      await emitLog(streamId, 'info', '📄 test-scenarios/_index.md 저장 완료');
    }

    // ── Complete ─────────────────────────────────────────────────────
    await emitProgress(streamId, 'writing-output', '✅ 테스트 시나리오 생성 완료', 100);
    await emitTaskEvent(streamId, { type: EventType.COMPLETE, message: '테스트 시나리오 생성 완료' });

  } catch (err) {
    await emitTaskEvent(streamId, {
      type: EventType.ERROR,
      message: `테스트 시나리오 생성 실패: ${err}`,
    });
    throw err;
  }

  return results;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildFlowFileName(flow: CatalogFlow): string {
  // Convert "Partner Sign-Up and Onboarding" → "f01-partner-sign-up-and-onboarding.md"
  const slug = flow.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${flow.id.toLowerCase()}-${slug}.md`;
}

async function emitProgress(
  streamId: string,
  phase: TestGenPhase,
  message: string,
  progress: number
): Promise<void> {
  const phaseLabels: Record<TestGenPhase, string> = {
    'parsing': '위키 문서 파싱',
    'analyzing-cross-flow': '크로스 플로우 분석',
    'building-prompt': '프롬프트 생성',
    'generating': 'LLM 시나리오 생성',
    'writing-output': '산출물 저장',
  };

  await emitTaskEvent(streamId, {
    type: 'phase_start',  // legacy event type for progress
    phase,
    message,
    data: {
      phase,
      phaseLabel: phaseLabels[phase],
      progress,
      timestamp: new Date().toISOString(),
    },
  });
}

async function emitLog(
  streamId: string,
  level: 'info' | 'warn' | 'error' | 'debug',
  message: string
): Promise<void> {
  await emitTaskEvent(streamId, {
    type: 'agent_log',  // legacy event type for log messages
    message,
    data: { level, timestamp: new Date().toISOString() },
  });
}

async function readFileContent(filePath: string): Promise<string> {
  const res = await fetch('/api/wiki/read-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  if (!res.ok) throw new Error(`Failed to read ${filePath}: ${res.status}`);
  const data = await res.json();
  return data.content ?? '';
}

async function writeFileContent(filePath: string, content: string): Promise<void> {
  await fetch('/api/wiki/write-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
}

async function writeTestIndex(
  wikiOutDir: string,
  results: TestGenerationResult[],
  deps: FlowDependency[],
  depDiagram: string
): Promise<void> {
  const flowResults = results.filter(r => !r.flowId.startsWith('chain-'));
  const chainResults = results.filter(r => r.flowId.startsWith('chain-'));

  const indexMd = `# Test Scenarios Index

> 자동 생성일: ${new Date().toISOString()}

## 플로우별 테스트 시나리오

| Flow | Name | 생성 상태 |
|------|------|----------|
${flowResults.map(r => `| ${r.flowId} | [${r.flowName}](${r.flowId.toLowerCase()}-test-guide.md) | ✅ |`).join('\n')}

## 크로스 플로우 체인 시나리오

| Chain | Flows | 생성 상태 |
|-------|-------|----------|
${chainResults.map(r => `| [${r.flowName}](cross-flow-${r.flowId.replace('chain-', '')}.md) | ${r.crossFlowChains[0]?.flows.join(' → ') ?? ''} | ✅ |`).join('\n')}

## 플로우 의존성 그래프

\`\`\`mermaid
${depDiagram}
\`\`\`

## 테스트 시나리오 유형

| 유형 | 설명 |
|------|------|
| Happy Path E2E | 정상 흐름 전체 step-by-step 검증 + DB assertion SQL |
| Data Integrity | 테이블 상태 전이(stateDiagram) + 경계값 케이스 |
| Error Recovery | 장애 시나리오별 Blast Radius + 디버깅 체크리스트 |
| Data Flow Trace | hop-by-hop 서비스 간 통신 추적 + 장애 매트릭스 |
| Cross-Flow Chain | 플로우 연쇄 E2E + 중간 장애 영향 분석 |
`;

  await writeFileContent(`${wikiOutDir}/test-scenarios/_index.md`, indexMd);
}
