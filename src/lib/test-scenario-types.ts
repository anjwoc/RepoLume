// ─── Test Scenario Types ────────────────────────────────────────────────────
// Shared type definitions for the wiki-based test scenario generation pipeline.

// ── Wiki Parser Output Types ────────────────────────────────────────────────

export interface Participant {
  name: string;
  alias: string;
  type: 'service' | 'db' | 'queue' | 'external' | 'unknown';
}

export interface Interaction {
  from: string;
  to: string;
  message: string;
  type: 'sync' | 'async' | 'reply' | 'alt-error';
  stepNumber?: number;
}

export interface AltPath {
  condition: string;
  steps: Interaction[];
  elseBranch?: {
    condition: string;
    steps: Interaction[];
  };
}

export interface TableInfo {
  name: string;
  db: string;
  role: string;
}

export interface SqlStep {
  stepNumber: number;
  title: string;
  description: string;
  sql: string;
  jpaMethod?: string;
  tableAction: string; // e.g., "[Oracle] TABLE ← INSERT (COL='VAL')"
}

export interface ErdRelation {
  from: string;
  to: string;
  relationship: string; // e.g., "logs", "references"
  cardinality: string;  // e.g., "||--o{", "||--o|"
}

export interface ComponentInfo {
  index: number;
  name: string;
  filePath: string;
  status: '✅' | '🔧' | '❌';
}

export interface ErrorPath {
  trigger: string;
  symptom?: string;
  dbStateOnFailure: string;
  retryBehavior?: string;
  fallback?: string;
  circuitBreaker?: string;
}

export interface ParsedFlowDocument {
  flowId: string;
  flowName: string;
  rawMarkdown: string;

  // Sequence Diagram에서 추출
  participants: Participant[];
  interactions: Interaction[];
  altPaths: AltPath[];

  // DB Data Flow에서 추출
  tables: TableInfo[];
  sqlSteps: SqlStep[];
  erd: ErdRelation[];

  // Component Chain에서 추출
  components: ComponentInfo[];

  // Error Handling에서 추출
  errorPaths: ErrorPath[];
}

// ── Cross-Flow Analysis Types ───────────────────────────────────────────────

export interface FlowDependency {
  from: string;       // e.g., "F03"
  to: string;         // e.g., "F04"
  via: string;        // e.g., "AFFILIATE_INFLOW"
  viaType: 'table' | 'kafka' | 'api' | 'event';
  relationship: 'produces' | 'consumes' | 'transforms';
}

export interface FlowChain {
  name: string;         // e.g., "클릭 → 주문 → 결제 → 정산"
  description: string;
  flows: string[];      // e.g., ["F03", "F04", "F05", "F10"]
  dependencies: FlowDependency[];
}

// ── Test Scenario Output Types ──────────────────────────────────────────────

export type ScenarioType =
  | 'happy-path'
  | 'data-integrity'
  | 'error-recovery'
  | 'cross-flow'
  | 'data-flow-trace';

export interface TestStep {
  stepNumber: number;
  service: string;
  action: string;
  expected: string;
  assertionSql?: string;
  protocol?: string;
  payload?: string;
}

export interface TestScenario {
  id: string;
  flowId: string;
  flowName: string;
  type: ScenarioType;
  title: string;
  description: string;
  preconditions: string[];
  steps: TestStep[];
  assertions: string[];
  debugChecklist?: string[];
  mermaidDiagram?: string;
}

export interface TestGenerationResult {
  flowId: string;
  flowName: string;
  scenarios: TestScenario[];
  crossFlowChains: FlowChain[];
  generatedAt: string;
  markdown: string;
}

// ── Generation Pipeline Types ───────────────────────────────────────────────

export type TestGenPhase =
  | 'parsing'
  | 'analyzing-cross-flow'
  | 'building-prompt'
  | 'generating'
  | 'writing-output';

export interface TestGenProgress {
  flowId: string;
  phase: TestGenPhase;
  phaseLabel: string;
  progress: number;     // 0-100
  message: string;
  timestamp: string;
  logEntries?: LogEntry[];
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// ── Catalog Types (from catalog.yaml) ───────────────────────────────────────

export interface CatalogTable {
  name: string;
  db: string;
}

export interface CatalogCodeRef {
  host: string;
  repo: string;
  path: string;
}

export interface CatalogStoredProc {
  name: string;
  db: string;
}

export interface CatalogFlow {
  id: string;
  name: string;
  repos: string[];
  entryClasses: string[];
  tables: CatalogTable[];
  storedProcs?: CatalogStoredProc[];
  codeRefs: CatalogCodeRef[];
}
