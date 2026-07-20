import { buildCrossFlowTestPrompt, buildTestPrompt } from './build-test-prompt';
import { buildFlowChains, detectCrossFlowDependencies } from './cross-flow-analyzer';
import type { CatalogFlow, ParsedFlowDocument } from './test-scenario-types';
import { parseFlowDocument } from './wiki-test-parser';

export interface ScenarioJobItem {
  flow_id: string;
  flow_name: string;
  output_file: string;
  prompt: string;
  kind: 'flow' | 'cross-flow';
}

interface BuildScenarioJobItemsInput {
  catalogFlows: CatalogFlow[];
  flowDocuments: Record<string, string>;
  debuggingContext: string;
  flowIds?: string[];
}

export function flowDocumentFileName(flow: Pick<CatalogFlow, 'id' | 'name'>): string {
  const slug = flow.name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return `${flow.id.toLowerCase()}-${slug}.md`;
}

export function buildScenarioJobItems(input: BuildScenarioJobItemsInput): {
  items: ScenarioJobItem[];
  parsedFlowIds: string[];
  missingFlowIds: string[];
} {
  const selected = input.flowIds?.length
    ? input.catalogFlows.filter((flow) => input.flowIds?.includes(flow.id))
    : input.catalogFlows;
  const parsed: ParsedFlowDocument[] = [];
  const missingFlowIds: string[] = [];

  for (const flow of selected) {
    const markdown = input.flowDocuments[flow.id];
    if (!markdown?.trim()) {
      missingFlowIds.push(flow.id);
      continue;
    }
    parsed.push(parseFlowDocument(markdown, flow.id));
  }

  const dependencies = detectCrossFlowDependencies(input.catalogFlows);
  const chains = buildFlowChains(input.catalogFlows, dependencies);
  const items: ScenarioJobItem[] = [];

  for (const parsedFlow of parsed) {
    const catalogFlow = input.catalogFlows.find((flow) => flow.id === parsedFlow.flowId);
    if (!catalogFlow) continue;
    items.push({
      flow_id: parsedFlow.flowId,
      flow_name: catalogFlow.name,
      output_file: `${parsedFlow.flowId.toLowerCase()}-test-guide.md`,
      prompt: buildTestPrompt(
        parsedFlow,
        catalogFlow,
        dependencies.filter(
          (dependency) => dependency.from === parsedFlow.flowId || dependency.to === parsedFlow.flowId,
        ),
        chains,
        input.debuggingContext,
      ),
      kind: 'flow',
    });
  }

  if (!input.flowIds?.length) {
    for (const chain of chains) {
      const chainFlows = parsed.filter((flow) => chain.flows.includes(flow.flowId));
      if (chainFlows.length < 2) continue;
      const chainId = chain.flows.join('-');
      items.push({
        flow_id: `chain-${chainId}`,
        flow_name: chain.name,
        output_file: `cross-flow-${chainId.toLowerCase()}.md`,
        prompt: buildCrossFlowTestPrompt(chain, chainFlows, input.debuggingContext),
        kind: 'cross-flow',
      });
    }
  }

  return {
    items,
    parsedFlowIds: parsed.map((flow) => flow.flowId),
    missingFlowIds,
  };
}
