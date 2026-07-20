// ─── Wiki Test Parser ───────────────────────────────────────────────────────
// Parses wiki business flow markdown documents to extract structured data
// for test scenario generation: Mermaid diagrams, SQL steps, component chains,
// ERD relations, and error paths.

import type {
  ParsedFlowDocument,
  Participant,
  Interaction,
  AltPath,
  TableInfo,
  SqlStep,
  ErdRelation,
  ComponentInfo,
  ErrorPath,
} from './test-scenario-types';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a business flow wiki markdown document into structured data.
 * Extracts sequence diagrams, SQL steps, component chains, ERD, and error paths.
 */
export function parseFlowDocument(markdown: string, flowId: string): ParsedFlowDocument {
  const flowName = extractFlowName(markdown) ?? flowId;

  return {
    flowId,
    flowName,
    rawMarkdown: markdown,
    participants: extractParticipants(markdown),
    interactions: extractInteractions(markdown),
    altPaths: extractAltPaths(markdown),
    tables: extractTableMap(markdown),
    sqlSteps: extractSqlSteps(markdown),
    erd: extractErd(markdown),
    components: extractComponentChain(markdown),
    errorPaths: extractErrorPaths(markdown),
  };
}

/**
 * Parse the system_analysis/debugging_flow.md for cross-cutting error scenarios.
 */
export function parseDebuggingFlow(markdown: string): ErrorPath[] {
  return extractErrorPaths(markdown);
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function extractFlowName(md: string): string | null {
  // Match the first H1 heading
  const h1 = md.match(/^#\s+(.+)$/m);
  return h1?.[1]?.trim() ?? null;
}

/**
 * Extract all mermaid code blocks of a given type.
 */
function extractMermaidBlocks(md: string, diagramType: string): string[] {
  const blocks: string[] = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(md)) !== null) {
    const content = match[1].trim();
    if (content.startsWith(diagramType)) {
      blocks.push(content);
    }
  }
  return blocks;
}

// ── Sequence Diagram Parsing ────────────────────────────────────────────────

function extractParticipants(md: string): Participant[] {
  const seqBlocks = extractMermaidBlocks(md, 'sequenceDiagram');
  const participants: Participant[] = [];
  const seen = new Set<string>();

  for (const block of seqBlocks) {
    const pRegex = /participant\s+(\S+)(?:\s+as\s+"?([^"\n]+)"?)?/g;
    let m: RegExpExecArray | null;
    while ((m = pRegex.exec(block)) !== null) {
      const name = m[2]?.trim() ?? m[1].trim();
      const alias = m[1].trim();
      if (seen.has(alias)) continue;
      seen.add(alias);

      participants.push({
        name,
        alias,
        type: classifyParticipant(name),
      });
    }
  }

  return participants;
}

function classifyParticipant(name: string): Participant['type'] {
  const lower = name.toLowerCase();
  if (/oracle|db|database|redis|mongo/i.test(lower)) return 'db';
  if (/kafka|topic|queue|event\s*bus|dlq|dead\s*letter/i.test(lower)) return 'queue';
  if (/partner|external|smilepay|smilecash|tax/i.test(lower)) return 'external';
  if (/api|service|controller|backend|frontend|gateway|admin|batch|processor|consumer/i.test(lower)) return 'service';
  return 'unknown';
}

function extractInteractions(md: string): Interaction[] {
  const seqBlocks = extractMermaidBlocks(md, 'sequenceDiagram');
  const interactions: Interaction[] = [];
  let stepCounter = 0;

  for (const block of seqBlocks) {
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Sync arrow: A->>B: message
      const syncMatch = trimmed.match(/^(\S+)\s*->>(\S+)\s*:\s*(.+)$/);
      if (syncMatch) {
        stepCounter++;
        interactions.push({
          from: syncMatch[1],
          to: syncMatch[2],
          message: syncMatch[3].trim(),
          type: 'sync',
          stepNumber: stepCounter,
        });
        continue;
      }

      // Async arrow: A--)B: message
      const asyncMatch = trimmed.match(/^(\S+)\s*--\)(\S+)\s*:\s*(.+)$/);
      if (asyncMatch) {
        stepCounter++;
        interactions.push({
          from: asyncMatch[1],
          to: asyncMatch[2],
          message: asyncMatch[3].trim(),
          type: 'async',
          stepNumber: stepCounter,
        });
        continue;
      }

      // Reply arrow: A-->>B: message
      const replyMatch = trimmed.match(/^(\S+)\s*-->>(\S+)\s*:\s*(.+)$/);
      if (replyMatch) {
        stepCounter++;
        interactions.push({
          from: replyMatch[1],
          to: replyMatch[2],
          message: replyMatch[3].trim(),
          type: 'reply',
          stepNumber: stepCounter,
        });
        continue;
      }

      // Error arrow: A-xB: message
      const errorMatch = trimmed.match(/^(\S+)\s*-x(\S+)\s*:\s*(.+)$/);
      if (errorMatch) {
        stepCounter++;
        interactions.push({
          from: errorMatch[1],
          to: errorMatch[2],
          message: errorMatch[3].trim(),
          type: 'alt-error',
          stepNumber: stepCounter,
        });
        continue;
      }
    }
  }

  return interactions;
}

function extractAltPaths(md: string): AltPath[] {
  const seqBlocks = extractMermaidBlocks(md, 'sequenceDiagram');
  const altPaths: AltPath[] = [];

  for (const block of seqBlocks) {
    const altRegex = /alt\s+(.+)\n([\s\S]*?)(?:else\s+(.+)\n([\s\S]*?))?end/g;
    let m: RegExpExecArray | null;
    while ((m = altRegex.exec(block)) !== null) {
      const condition = m[1].trim();
      const mainSteps = parseInteractionsFromBlock(m[2]);
      const elseBranch = m[3]
        ? {
            condition: m[3].trim(),
            steps: parseInteractionsFromBlock(m[4] ?? ''),
          }
        : undefined;

      altPaths.push({ condition, steps: mainSteps, elseBranch });
    }
  }

  return altPaths;
}

function parseInteractionsFromBlock(block: string): Interaction[] {
  const interactions: Interaction[] = [];
  const lines = block.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\S+)\s*(->>|-->>|--\)|->|-x)(\S+)\s*:\s*(.+)$/);
    if (match) {
      const arrowType = match[2];
      let type: Interaction['type'] = 'sync';
      if (arrowType === '-->>') type = 'reply';
      else if (arrowType === '--)') type = 'async';
      else if (arrowType === '-x') type = 'alt-error';

      interactions.push({
        from: match[1],
        to: match[3],
        message: match[4].trim(),
        type,
      });
    }
  }
  return interactions;
}

// ── Table Map Parsing ───────────────────────────────────────────────────────

function extractTableMap(md: string): TableInfo[] {
  const tables: TableInfo[] = [];

  // Look for markdown table with columns: Table | DB | Role
  const tableMapRegex = /\|\s*Table\s*\|\s*DB\s*\|\s*Role\s*\|.*\n\|[\s-|]*\n((?:\|.*\n)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = tableMapRegex.exec(md)) !== null) {
    const rows = m[1].trim().split('\n');
    for (const row of rows) {
      const cols = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        tables.push({
          name: cols[0].replace(/`/g, ''),
          db: cols[1],
          role: cols[2],
        });
      }
    }
  }

  return tables;
}

// ── SQL Step Parsing ────────────────────────────────────────────────────────

function extractSqlSteps(md: string): SqlStep[] {
  const steps: SqlStep[] = [];

  // Pattern: **[STEP N] Title**
  const stepRegex = /\*\*\[STEP\s+(\d+)]\s*([^*]*)\*\*\s*\n([\s\S]*?)(?=\*\*\[STEP|\n##\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = stepRegex.exec(md)) !== null) {
    const stepNumber = parseInt(m[1], 10);
    const title = m[2].trim();
    const body = m[3];

    // Extract SQL from code blocks
    const sqlMatch = body.match(/```sql\s*\n([\s\S]*?)```/);
    const sql = sqlMatch?.[1]?.trim() ?? '';

    // Extract JPA method annotation
    const jpaMatch = body.match(/--\s*JPA:\s*(.+)/);
    const jpaMethod = jpaMatch?.[1]?.trim();

    // Extract table action summary (e.g., [Oracle] TABLE ← INSERT)
    const actionMatch = body.match(/\[Oracle\]\s+(.+)/);
    const tableAction = actionMatch?.[1]?.trim() ?? '';

    // Description is the first paragraph after the title
    const descMatch = body.match(/^(?!\*\*|\||-|```)(.*\S.*)$/m);
    const description = descMatch?.[1]?.trim() ?? '';

    steps.push({
      stepNumber,
      title,
      description,
      sql,
      jpaMethod,
      tableAction,
    });
  }

  return steps;
}

// ── ERD Parsing ─────────────────────────────────────────────────────────────

function extractErd(md: string): ErdRelation[] {
  const erdBlocks = extractMermaidBlocks(md, 'erDiagram');
  const relations: ErdRelation[] = [];

  for (const block of erdBlocks) {
    // Match: TABLE_A ||--o{ TABLE_B : relationship
    const relRegex = /(\S+)\s+(\|{1,2}--o[{|]|\|{1,2}--\|{1,2}|o[{|]--\|{1,2})\s+(\S+)\s*:\s*(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = relRegex.exec(block)) !== null) {
      relations.push({
        from: m[1],
        to: m[3],
        cardinality: m[2],
        relationship: m[4],
      });
    }
  }

  return relations;
}

// ── Component Chain Parsing ─────────────────────────────────────────────────

function extractComponentChain(md: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];

  // Match table rows with: | # | Component | file:line | Status |
  const chainRegex = /\|\s*(\d+)\s*\|\s*`?([^|`]+)`?\s*\|\s*`?([^|`]+)`?\s*\|\s*([✅🔧❌])\s*\|/g;
  let m: RegExpExecArray | null;
  while ((m = chainRegex.exec(md)) !== null) {
    components.push({
      index: parseInt(m[1], 10),
      name: m[2].trim(),
      filePath: m[3].trim(),
      status: m[4].trim() as ComponentInfo['status'],
    });
  }

  return components;
}

// ── Error Path Extraction ───────────────────────────────────────────────────

function extractErrorPaths(md: string): ErrorPath[] {
  const errorPaths: ErrorPath[] = [];

  // Extract from markdown sections about errors, debugging, failure
  // Look for symptom/cause/action patterns
  const errorSectionRegex = /\*{1,2}증상:?\*{0,2}\s*(.+?)(?:\n|$)/gi;
  const causeSectionRegex = /\*{1,2}원인:?\*{0,2}\s*(.+?)(?:\n|$)/gi;

  // Also extract from alt blocks in sequence diagrams (already handled by altPaths)

  // Parse the structured debugging sections
  const scenarioRegex = /###\s+Scenario\s+\w+:\s*(.+)\n([\s\S]*?)(?=###\s+Scenario|---|\n##\s|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = scenarioRegex.exec(md)) !== null) {
    const trigger = m[1].trim();
    const body = m[2];

    // Extract troubleshooting steps
    const stepsMatch = body.match(/\*\*Troubleshooting Steps:\*\*\s*\n([\s\S]*?)(?=###|$)/);
    const retryBehavior = stepsMatch?.[1]?.trim();

    errorPaths.push({
      trigger,
      dbStateOnFailure: extractDbStateFromBlock(body),
      retryBehavior,
      fallback: extractPatternFromBlock(body, 'Fallback'),
      circuitBreaker: extractPatternFromBlock(body, 'Circuit Breaker'),
    });
  }

  // Also extract bullet-point error descriptions
  const bulletErrorRegex = /\*\s+\*\*(.+?)\*\*\s*\n\s+\*\s+\*\*\s*증상:\*\*\s*(.+)\n\s+\*\s+\*\*\s*원인:\*\*\s*(.+)/g;
  while ((m = bulletErrorRegex.exec(md)) !== null) {
    errorPaths.push({
      trigger: m[1].trim(),
      symptom: m[2].trim(),
      dbStateOnFailure: '',
      retryBehavior: m[3].trim(),
    });
  }

  return errorPaths;
}

function extractDbStateFromBlock(block: string): string {
  // Look for STATUS changes or DB state descriptions
  const stateMatch = block.match(/STATUS\s*=\s*'(\w+)'/);
  return stateMatch ? `STATUS='${stateMatch[1]}'` : '';
}

function extractPatternFromBlock(block: string, pattern: string): string | undefined {
  const regex = new RegExp(`${pattern}[:\\s]+(.+?)(?:\\n|$)`, 'i');
  const match = block.match(regex);
  return match?.[1]?.trim();
}
