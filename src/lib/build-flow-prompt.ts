import { resolveInstance, mcpToolPrefix } from './mcp-instance-registry';
import type { McpInstance } from './mcp-instance-registry';
import type { FlowDefinition } from './flow-catalog';

export type { FlowDefinition } from './flow-catalog';

const FORMAT_RULES = `
### CRITICAL OUTPUT FORMAT RULES
1. Output ONLY the raw generated content (Markdown).
2. DO NOT include any conversational text, pleasantries, intro, or outro.
3. DO NOT repeat, leak, or mention the prompt instructions in your output.
4. Your response must begin immediately with the actual content.
`;

export function buildFlowPrompt(flow: FlowDefinition, instances: McpInstance[]): string {
  const tableLines = flow.tables.map(t => {
    const inst = resolveInstance(instances, 'db-schema', { database: t.db });
    return inst
      ? `  - ${t.name} [${t.db}] → ${mcpToolPrefix(inst)}* (${inst.instanceName})`
      : `  - ${t.name} [${t.db}] → (no MCP configured — infer from JPA @Column annotations)`;
  }).join('\n');

  const spLines = (flow.storedProcs ?? []).map(sp => {
    const inst = resolveInstance(instances, 'db-stored-proc', { database: sp.db });
    return inst
      ? `  - ${sp.name} [${sp.db}] → ${mcpToolPrefix(inst)}* (${inst.instanceName})`
      : `  - ${sp.name} [${sp.db}] → (no MCP configured — check @SaturnProcedure annotation)`;
  }).join('\n');

  const codeLines = flow.codeRefs.map(ref => {
    const inst = resolveInstance(instances, 'code-reader', { host: ref.host });
    return inst
      ? `  - [${ref.host}] ${ref.repo}/${ref.path} → ${mcpToolPrefix(inst)}get_file_contents (${inst.instanceName})`
      : `  - [${ref.host}] ${ref.repo}/${ref.path} → (no MCP configured — use codegraph_explore)`;
  }).join('\n');

  return `You are an expert technical writer and software architect analyzing a REAL production codebase.
Your task is to generate a comprehensive business flow wiki page in Markdown format.

## Flow: ${flow.name} (${flow.id})

**Repos:** ${flow.repos.join(', ')}
**Entry points:** ${flow.entryClasses.join(', ')}

## Context Collection (execute in order before writing)

### 1. Call Chain
\`\`\`
codegraph query "${flow.entryClasses.join(' ')}"
\`\`\`

### 2. Table Schemas (MCP auto-selected by DB)
${tableLines || '  (none)'}

### 3. Stored Procedures
${spLines || '  (none)'}

### 4. Source Code
${codeLines || '  (none)'}

## Output Requirements (ALL 7 sections mandatory)

Write a Markdown wiki page that includes every section below. Missing any section = incomplete document.

1. **Overview** — one-sentence purpose, related modules (repos/submodules), key history (tickets/dates)
2. **Workflow** — mermaid sequenceDiagram with DB tables as participants (e.g. \`DB_Req as "Oracle: LINKREW_MESSAGE_REQUEST"\`), real method names on arrows
3. **DB-Level Data Flow** ★ REQUIRED — document is incomplete without this section
   - Full table map: \`| Table | DB | Role |\`
   - Per-step SQL: [STEP 1]…[STEP N] with real SELECT/INSERT/UPDATE/EXEC, actual column names, WHERE values, enum constants ('N'/'Y', 'B'/'C' etc.)
   - JPA methods annotated: \`-- JPA: findByPartnerType(PartnerType.B2C)\`
   - Unverifiable SQL: \`-- NOTE: MCP not connected — manual verification required\`
   - Processing order summary: \`[Oracle] TABLE ← INSERT (COL='VAL')\` format
   - Table reference ERD (text)
4. **Key Components** — entry class, service classes with method signatures, repositories; file:line refs
5. **Component Chain Completeness** — \`| # | Component | file:line | Status (✅/🔧/❌) |\`
6. **Error Handling** — DB state on failure, retry behavior
7. **Domain Knowledge Q&A** — non-obvious business rules with real code snippets

## STRICTLY EXCLUDE
- Local development environment issues
- Service startup order
- Docker/k8s configuration
- Deployment/CI details

## SQL Writing Rules
- Use only real column names from schema — never guess
- Unverifiable: \`-- NOTE: MCP not connected — manual verification required\`
- JPA method: \`-- JPA: methodName(param)\`
${FORMAT_RULES}`;
}
