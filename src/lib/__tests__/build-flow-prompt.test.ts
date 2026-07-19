import { describe, it, expect } from 'vitest';
import { buildFlowPrompt } from '../build-flow-prompt';
import type { FlowDefinition } from '../flow-catalog';
import type { McpInstance } from '../mcp-instance-registry';

const flow: FlowDefinition = {
  id: 'F18',
  name: 'Notification Dispatch Batch',
  repos: ['notification-batch'],
  entryClasses: ['NotificationRequestJobConfig', 'NotificationService'],
  tables: [
    { name: 'NOTIFICATION_REQUEST', db: 'ORDERS' },
    { name: 'notification_outbox',  db: 'notifications' },
  ],
  storedProcs: [
    { name: 'UPSERT_NOTIFICATION_OUTBOX', db: 'notifications' },
  ],
  codeRefs: [
    { host: 'github.example.com', repo: 'notification-batch', path: 'lib-message/src/NotificationService.java' },
  ],
};

const instances: McpInstance[] = [
  { instanceName: 'oracle-orders', tool: 'oracle', roles: ['db-schema', 'db-stored-proc'], scope: { databases: ['ORDERS'] } },
  { instanceName: 'devdb-notifications', tool: 'devdb', roles: ['db-schema'],              scope: { databases: ['notifications'] } },
  { instanceName: 'github-enterprise', tool: 'github', roles: ['code-reader'],             scope: { host: 'github.example.com' } },
];

describe('buildFlowPrompt', () => {
  it('contains flow name', () => {
    expect(buildFlowPrompt(flow, instances)).toContain('Notification Dispatch Batch');
  });

  it('contains oracle MCP hint for ORDERS table', () => {
    const p = buildFlowPrompt(flow, instances);
    expect(p).toContain('ORDERS');
    expect(p).toContain('mcp__oracle__');
  });

  it('contains devdb MCP hint for notifications table', () => {
    const p = buildFlowPrompt(flow, instances);
    expect(p).toContain('notifications');
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
