// ─── Test Prompt Builder ────────────────────────────────────────────────────
// Builds LLM prompts for generating test scenarios from parsed wiki documents.
// Follows the same pattern as build-flow-prompt.ts but targets test generation.

import type {
  ParsedFlowDocument,
  FlowDependency,
  FlowChain,
  CatalogFlow,
  ScenarioType,
} from './test-scenario-types';

const FORMAT_RULES = `
### CRITICAL OUTPUT FORMAT RULES
1. Output ONLY the raw generated content (Markdown).
2. DO NOT include any conversational text, pleasantries, intro, or outro.
3. DO NOT repeat, leak, or mention the prompt instructions in your output.
4. Your response must begin immediately with the actual content.
5. All mermaid diagrams MUST be syntactically correct and renderable.
6. Use Korean for descriptions, English for technical terms and code.
`;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the full test scenario generation prompt for a single flow.
 */
export function buildTestPrompt(
  parsed: ParsedFlowDocument,
  flow: CatalogFlow,
  crossFlowDeps: FlowDependency[],
  crossFlowChains: FlowChain[],
  debuggingContext: string
): string {
  const participantSummary = parsed.participants
    .map(p => `  - ${p.alias} (${p.name}) [${p.type}]`)
    .join('\n');

  const interactionSummary = parsed.interactions
    .map(i => `  ${i.stepNumber ?? '?'}. ${i.from} ${arrowForType(i.type)} ${i.to}: ${i.message}`)
    .join('\n');

  const tableSummary = parsed.tables
    .map(t => `  - ${t.name} [${t.db}] — ${t.role}`)
    .join('\n');

  const sqlSummary = parsed.sqlSteps
    .map(s => `  [STEP ${s.stepNumber}] ${s.title}\n    SQL: ${s.sql.slice(0, 200)}${s.sql.length > 200 ? '...' : ''}\n    JPA: ${s.jpaMethod ?? 'N/A'}\n    Action: ${s.tableAction}`)
    .join('\n\n');

  const componentSummary = parsed.components
    .map(c => `  ${c.index}. ${c.name} — ${c.filePath} [${c.status}]`)
    .join('\n');

  const errorSummary = parsed.errorPaths
    .map(e => `  - Trigger: ${e.trigger}\n    DB State: ${e.dbStateOnFailure}\n    Retry: ${e.retryBehavior ?? 'N/A'}`)
    .join('\n');

  const altPathSummary = parsed.altPaths
    .map(a => `  - Condition: ${a.condition}\n    Steps: ${a.steps.length}\n    Else: ${a.elseBranch?.condition ?? 'N/A'}`)
    .join('\n');

  const crossFlowSummary = crossFlowDeps
    .map(d => `  - ${d.from} → ${d.to} via ${d.via} [${d.viaType}] (${d.relationship})`)
    .join('\n');

  const chainSummary = crossFlowChains
    .filter(c => c.flows.includes(parsed.flowId))
    .map(c => `  - ${c.name}: ${c.flows.join(' → ')}\n    ${c.description}`)
    .join('\n');

  const erdSummary = parsed.erd
    .map(e => `  - ${e.from} ${e.cardinality} ${e.to} : ${e.relationship}`)
    .join('\n');

  return `You are an expert QA engineer and system architect.
Your task is to generate comprehensive test scenarios from a production system's wiki documentation.

## Flow Under Test: ${parsed.flowName} (${parsed.flowId})

**Repositories:** ${flow.repos.join(', ')}
**Entry Points:** ${flow.entryClasses.join(', ')}

---

## Extracted Architecture (from wiki document)

### Participants (Service/DB/Queue nodes)
${participantSummary || '  (none extracted)'}

### Interaction Sequence (Happy Path)
${interactionSummary || '  (none extracted)'}

### Alternative/Error Paths (from alt blocks)
${altPathSummary || '  (none extracted)'}

### DB Tables
${tableSummary || '  (none extracted)'}

### Per-Step SQL Operations
${sqlSummary || '  (none extracted)'}

### ERD Relations
${erdSummary || '  (none extracted)'}

### Component Chain
${componentSummary || '  (none extracted)'}

### Known Error Scenarios
${errorSummary || '  (none extracted)'}

### Cross-Flow Dependencies
${crossFlowSummary || '  (none detected)'}

### Business Chain Membership
${chainSummary || '  (not part of any known chain)'}

---

## Debugging Context (from system_analysis/debugging_flow.md)
${debuggingContext || '(no debugging context available)'}

---

## OUTPUT REQUIREMENTS — Generate ALL 5 Sections Below

### Section 1: Happy Path E2E 테스트 시나리오

정상 흐름의 전체 과정을 step-by-step으로 검증하는 시나리오를 생성하세요.

**Required format:**
- 전제 조건 (Preconditions): 테스트 시작 전 필요한 상태
- 테스트 단계 표:
  \`| Step | Service | Action | Protocol | Expected Result |\`
- DB 검증 포인트: 각 주요 step 후 실행할 assertion SQL
- 최종 상태 검증: 모든 테이블의 기대 상태

### Section 2: Data Integrity 테스트 시나리오

각 테이블의 STATUS 또는 핵심 컬럼의 **상태 전이(State Transition)**를 검증하는 시나리오를 생성하세요.

**Required format:**
- Mermaid \`stateDiagram-v2\`로 상태 전이 맵 표현
- 각 상태 조합별 테스트 케이스 표:
  \`| Case | Input | Expected STATUS | Expected Side Effect |\`
- 경계값/엣지 케이스 포함 (중복 데이터, NULL 입력, 타임아웃 등)

### Section 3: Error Recovery 디버깅 가이드

장애 시나리오별 디버깅 체크리스트와 복구 절차를 생성하세요.

**Required format:**
- 장애 시나리오명 및 트리거 조건
- Blast Radius Mermaid 다이어그램 (영향 범위)
- 디버깅 체크리스트: \`☐ 항목\` 형식 (메트릭, 로그, 코드 확인 순서)
- 복구 절차: 단기/장기 조치
- 관련 모니터링 포인트: 대시보드, 알림 설정

### Section 4: Data Flow Trace (서비스 간 통신 추적)

각 서비스 hop에서의 **데이터 변환**을 추적하는 trace를 생성하세요.

**Required format:**
- Hop-by-Hop 데이터 변환 표:
  \`| Hop | From → To | Protocol | Payload (핵심 필드) | 변환 내용 |\`
- 통신 장애 테스트 매트릭스:
  \`| Hop | 장애 시나리오 | Expected Behavior | 복구 방법 |\`
- 전체 데이터 여정 Mermaid 다이어그램

### Section 5: Cross-Flow 연쇄 테스트 시나리오 (해당되는 경우)

이 플로우가 참여하는 비즈니스 체인의 E2E 시나리오를 생성하세요.

**Required format:**
- 전체 체인 Mermaid 다이어그램 (graph LR)
- Phase별 검증 표:
  \`| Phase | Flow | Key Table | Expected State |\`
- 체인 중간 장애 시나리오: 특정 flow 실패 시 전체 체인에 미치는 영향

---

## STRICTLY EXCLUDE
- 로컬 개발환경 이슈
- Docker/k8s 설정
- 배포/CI 세부사항
- 이론적인 설명 (실제 코드/테이블 기반 시나리오만)

${FORMAT_RULES}`;
}

/**
 * Build a prompt for generating cross-flow chain test scenarios.
 */
export function buildCrossFlowTestPrompt(
  chain: FlowChain,
  parsedFlows: ParsedFlowDocument[],
  debuggingContext: string
): string {
  const flowSummaries = parsedFlows.map(p => {
    const tables = p.tables.map(t => t.name).join(', ');
    const steps = p.sqlSteps.length;
    return `  - ${p.flowId} (${p.flowName}): ${tables} [${steps} SQL steps]`;
  }).join('\n');

  const depSummary = chain.dependencies
    .map(d => `  - ${d.from} → ${d.to} via ${d.via} [${d.viaType}]`)
    .join('\n');

  return `You are an expert QA engineer analyzing a multi-service production system.
Generate a comprehensive cross-flow E2E test scenario for the following business chain.

## Business Chain: ${chain.name}
${chain.description}

### Flows in Chain
${flowSummaries}

### Dependencies
${depSummary}

---

## OUTPUT REQUIREMENTS

### 1. 전체 체인 E2E 시나리오
- 체인 전체를 관통하는 Mermaid sequenceDiagram (모든 서비스, DB, 큐 포함)
- Phase별 검증 표: \`| Phase | Flow | Service | Action | Key Table | Expected State |\`
- 전체 DB assertion SQL 목록

### 2. 체인 중간 장애 시나리오
- 각 flow 실패 시 downstream flow에 미치는 영향 분석
- 복구 순서 (어디서부터 재처리할지)
- 데이터 정합성 검증 쿼리

### 3. 데이터 정합성 교차 검증
- 체인 시작~끝까지의 데이터 무결성 검증 쿼리
- 금액/수량 대사(Reconciliation) 쿼리

## Debugging Context
${debuggingContext || '(none)'}

${FORMAT_RULES}`;
}

/**
 * Build a prompt for a specific scenario type only (for incremental generation).
 */
export function buildSingleScenarioPrompt(
  parsed: ParsedFlowDocument,
  scenarioType: ScenarioType
): string {
  const sectionMap: Record<ScenarioType, string> = {
    'happy-path': buildHappyPathSection(parsed),
    'data-integrity': buildDataIntegritySection(parsed),
    'error-recovery': buildErrorRecoverySection(parsed),
    'data-flow-trace': buildDataFlowTraceSection(parsed),
    'cross-flow': '(Use buildCrossFlowTestPrompt for cross-flow scenarios)',
  };

  return `You are an expert QA engineer.
Generate a single test scenario for ${parsed.flowName} (${parsed.flowId}).

${sectionMap[scenarioType]}

${FORMAT_RULES}`;
}

// ── Internal Section Builders ───────────────────────────────────────────────

function arrowForType(type: string): string {
  switch (type) {
    case 'sync': return '->>';
    case 'async': return '-->>';
    case 'reply': return '-->>';
    case 'alt-error': return '-x';
    default: return '->>';
  }
}

function buildHappyPathSection(parsed: ParsedFlowDocument): string {
  const steps = parsed.interactions
    .filter(i => i.type !== 'alt-error')
    .map(i => `  ${i.stepNumber ?? '?'}. ${i.from} → ${i.to}: ${i.message}`)
    .join('\n');

  const sqls = parsed.sqlSteps
    .map(s => `  [STEP ${s.stepNumber}] ${s.title}: ${s.tableAction}`)
    .join('\n');

  return `## Generate Happy Path E2E Test

### Known Interaction Steps:
${steps || '  (none)'}

### Known SQL Operations:
${sqls || '  (none)'}

Generate a complete step-by-step test scenario with:
- Preconditions
- Test steps table: | Step | Service | Action | Expected |
- DB assertion SQL for each major step
- Final state verification`;
}

function buildDataIntegritySection(parsed: ParsedFlowDocument): string {
  const tables = parsed.tables
    .map(t => `  - ${t.name}: ${t.role}`)
    .join('\n');

  const sqls = parsed.sqlSteps
    .map(s => `  - ${s.tableAction}`)
    .join('\n');

  return `## Generate Data Integrity Test

### Tables Under Test:
${tables || '  (none)'}

### State Changes:
${sqls || '  (none)'}

Generate:
- stateDiagram-v2 for each STATUS column
- Test case table for all state combinations
- Edge cases (duplicates, nulls, timeouts)`;
}

function buildErrorRecoverySection(parsed: ParsedFlowDocument): string {
  const errors = parsed.errorPaths
    .map(e => `  - ${e.trigger}: ${e.dbStateOnFailure}`)
    .join('\n');

  const alts = parsed.altPaths
    .map(a => `  - ${a.condition}`)
    .join('\n');

  return `## Generate Error Recovery / Debugging Guide

### Known Error Paths:
${errors || '  (none)'}

### Alt Paths from Sequence Diagrams:
${alts || '  (none)'}

Generate:
- Blast radius mermaid diagram per scenario
- Debugging checklist (☐ items)
- Recovery procedures (short-term / long-term)`;
}

function buildDataFlowTraceSection(parsed: ParsedFlowDocument): string {
  const interactions = parsed.interactions
    .map(i => `  ${i.from} → ${i.to} [${i.type}]: ${i.message}`)
    .join('\n');

  return `## Generate Data Flow Trace

### Known Service Interactions:
${interactions || '  (none)'}

Generate:
- Hop-by-hop data transformation table
- Communication failure test matrix
- Full data journey mermaid diagram`;
}
