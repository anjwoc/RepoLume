// ─── Cross-Flow Analyzer ────────────────────────────────────────────────────
// Analyzes catalog.yaml flow definitions to detect inter-flow dependencies
// based on shared tables, Kafka topics, and business flow document references.

import type {
  CatalogFlow,
  FlowDependency,
  FlowChain,
} from './test-scenario-types';

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Detect cross-flow dependencies by analyzing shared tables in catalog flows.
 */
export function detectCrossFlowDependencies(flows: CatalogFlow[]): FlowDependency[] {
  const deps: FlowDependency[] = [];

  // Build table → flow[] map
  const tableToFlows = new Map<string, { flowId: string; flowName: string }[]>();
  for (const flow of flows) {
    for (const table of flow.tables) {
      const key = `${table.name}::${table.db}`;
      const existing = tableToFlows.get(key) ?? [];
      existing.push({ flowId: flow.id, flowName: flow.name });
      tableToFlows.set(key, existing);
    }
  }

  // Shared tables = dependencies
  for (const [tableKey, flowRefs] of tableToFlows) {
    if (flowRefs.length < 2) continue;
    const tableName = tableKey.split('::')[0];

    // Create pairwise dependencies (respect flow ID ordering as natural sequence)
    for (let i = 0; i < flowRefs.length; i++) {
      for (let j = i + 1; j < flowRefs.length; j++) {
        const fromId = flowRefs[i].flowId;
        const toId = flowRefs[j].flowId;

        // Skip if same flow
        if (fromId === toId) continue;

        // Check if this dependency already exists
        const exists = deps.some(
          d => d.from === fromId && d.to === toId && d.via === tableName
        );
        if (exists) continue;

        deps.push({
          from: fromId,
          to: toId,
          via: tableName,
          viaType: 'table',
          relationship: inferRelationship(fromId, toId, tableName),
        });
      }
    }
  }

  return deps;
}

/**
 * Build named flow chains from detected dependencies.
 * Groups related flows into end-to-end business scenarios.
 */
export function buildFlowChains(
  flows: CatalogFlow[],
  deps: FlowDependency[]
): FlowChain[] {
  const chains: FlowChain[] = [];

  // Auto-detect additional chains from dependency graph
  const autoChainsFromGraph = detectChainsFromGraph(flows, deps);
  for (const autoChain of autoChainsFromGraph) {
    // Skip if already covered by known chains
    const isDuplicate = chains.some(c =>
      c.flows.length === autoChain.flows.length &&
      c.flows.every(f => autoChain.flows.includes(f))
    );
    if (!isDuplicate) {
      chains.push(autoChain);
    }
  }

  return chains;
}

/**
 * Generate a mermaid dependency graph for all detected dependencies.
 */
export function generateDependencyDiagram(
  flows: CatalogFlow[],
  deps: FlowDependency[]
): string {
  const lines: string[] = ['graph LR'];

  // Add flow nodes
  for (const flow of flows) {
    const tables = flow.tables.map(t => t.name).join(', ');
    lines.push(`    ${flow.id}["${flow.id}: ${flow.name}<br/>${tables}"]`);
  }

  // Add edges
  for (const dep of deps) {
    const label = dep.via;
    lines.push(`    ${dep.from} -->|${label}| ${dep.to}`);
  }

  return lines.join('\n');
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function inferRelationship(
  fromId: string,
  toId: string,
  _tableName: string
): FlowDependency['relationship'] {
  const fromNum = parseInt(fromId.replace('F', ''), 10);
  const toNum = parseInt(toId.replace('F', ''), 10);

  // Lower-numbered flows typically produce data consumed by higher-numbered flows
  if (fromNum < toNum) return 'produces';
  if (fromNum > toNum) return 'consumes';
  return 'transforms';
}

/**
 * Auto-detect chains from the dependency graph using DFS.
 * Finds paths of length >= 3 that aren't covered by known chains.
 */
function detectChainsFromGraph(
  flows: CatalogFlow[],
  deps: FlowDependency[]
): FlowChain[] {
  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const dep of deps) {
    const existing = adj.get(dep.from) ?? [];
    if (!existing.includes(dep.to)) {
      existing.push(dep.to);
    }
    adj.set(dep.from, existing);
  }

  const chains: FlowChain[] = [];
  const visited = new Set<string>();

  // Find all paths of length >= 3
  function dfs(current: string, path: string[]): void {
    if (path.length >= 3) {
      const pathKey = path.join('→');
      if (!visited.has(pathKey)) {
        visited.add(pathKey);

        const flowNames = path.map(fid => {
          const flow = flows.find(f => f.id === fid);
          return flow ? `${fid}(${flow.name})` : fid;
        });

        const chainDeps = deps.filter(d =>
          path.includes(d.from) && path.includes(d.to)
        );

        chains.push({
          name: `Auto-detected: ${path.join(' → ')}`,
          description: `자동 감지된 플로우 체인: ${flowNames.join(' → ')}`,
          flows: [...path],
          dependencies: chainDeps,
        });
      }
    }

    // Continue DFS if path is still short enough
    if (path.length >= 6) return; // Cap chain length

    const neighbors = adj.get(current) ?? [];
    for (const next of neighbors) {
      if (!path.includes(next)) {
        dfs(next, [...path, next]);
      }
    }
  }

  for (const flow of flows) {
    dfs(flow.id, [flow.id]);
  }

  return chains;
}
