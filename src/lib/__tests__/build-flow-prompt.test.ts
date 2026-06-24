import { describe, it, expect } from 'vitest';
import { buildFlowPrompt } from '../build-flow-prompt';
import type { FlowDefinition } from '../flow-catalog';
import type { McpInstance } from '../mcp-instance-registry';

const flow: FlowDefinition = {
  id: 'F18',
  name: 'Linkrew Message Dispatch Batch',
  repos: ['affiliate-batch'],
  entryClasses: ['LinkrewMessageRequestJobConfig', 'LinkrewMessageService'],
  tables: [
    { name: 'LINKREW_MESSAGE_REQUEST', db: 'O_GAFFILIATE' },
    { name: 'auto_linkrew_common',     db: 'nautomaildb' },
  ],
  storedProcs: [
    { name: 'UPGMKT_Affiliate_AutoLinkrewCommon_Insert', db: 'nautomaildb' },
  ],
  codeRefs: [
    { host: 'github.gmarket.com', repo: 'affiliate-batch', path: 'lib-message/src/LinkrewMessageService.java' },
  ],
};

const instances: McpInstance[] = [
  { instanceName: 'oracle-gaffiliate', tool: 'oracle', roles: ['db-schema', 'db-stored-proc'], scope: { databases: ['O_GAFFILIATE'] } },
  { instanceName: 'devdb-nautomaildb', tool: 'devdb', roles: ['db-schema'],                   scope: { databases: ['nautomaildb'] } },
  { instanceName: 'github-enterprise', tool: 'github', roles: ['code-reader'],                scope: { host: 'github.gmarket.com' } },
];

describe('buildFlowPrompt', () => {
  it('contains flow name', () => {
    expect(buildFlowPrompt(flow, instances)).toContain('Linkrew Message Dispatch Batch');
  });

  it('contains oracle MCP hint for O_GAFFILIATE table', () => {
    const p = buildFlowPrompt(flow, instances);
    expect(p).toContain('O_GAFFILIATE');
    expect(p).toContain('mcp__oracle__');
  });

  it('contains devdb MCP hint for nautomaildb table', () => {
    const p = buildFlowPrompt(flow, instances);
    expect(p).toContain('nautomaildb');
    expect(p).toContain('mcp__devdb__');
  });

  it('falls back gracefully when no MCP instance configured', () => {
    expect(buildFlowPrompt(flow, [])).toContain('no MCP configured');
  });

  it('contains STRICTLY EXCLUDE section', () => {
    expect(buildFlowPrompt(flow, instances)).toContain('STRICTLY EXCLUDE');
  });

  it('contains DB-Level Data Flow requirement', () => {
    expect(buildFlowPrompt(flow, instances)).toContain('DB-Level Data Flow');
  });

  it('contains Component Chain Completeness requirement', () => {
    expect(buildFlowPrompt(flow, instances)).toContain('Component Chain Completeness');
  });
});
