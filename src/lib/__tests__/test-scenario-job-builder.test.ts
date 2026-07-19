import { describe, expect, it } from 'vitest';

import { buildScenarioJobItems, flowDocumentFileName } from '../test-scenario-job-builder';


describe('test scenario job builder', () => {
  const flow = {
    id: 'F01',
    name: 'Partner Onboarding',
    repos: ['web', 'api'],
    entryClasses: ['SignUpService'],
    tables: [{ name: 'MEMBER', db: 'main' }],
    codeRefs: [],
  };

  it('builds a deterministic output item from a parsed flow document', () => {
    const markdown = [
      '# Partner Onboarding',
      '```mermaid',
      'sequenceDiagram',
      'participant U as User',
      'participant A as API',
      'U->>A: Sign up',
      '```',
    ].join('\n');

    const result = buildScenarioJobItems({
      catalogFlows: [flow],
      flowDocuments: { F01: markdown },
      debuggingContext: '',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      flow_id: 'F01',
      flow_name: 'Partner Onboarding',
      output_file: 'f01-test-guide.md',
      kind: 'flow',
    });
    expect(result.items[0].prompt).toContain('Happy Path');
  });

  it('uses the same deterministic wiki document filename as generation', () => {
    expect(flowDocumentFileName(flow)).toBe('f01-partner-onboarding.md');
  });
});
