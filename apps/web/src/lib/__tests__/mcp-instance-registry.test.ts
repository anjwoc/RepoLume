import { describe, it, expect } from 'vitest';
import { resolveInstance, mcpToolPrefix, McpInstance } from '../mcp-instance-registry';

const fixtures: McpInstance[] = [
  {
    instanceName: 'oracle-orders',
    tool: 'oracle',
    roles: ['db-schema', 'db-stored-proc', 'db-query'],
    scope: { databases: ['ORDERS'] },
  },
  {
    instanceName: 'devdb-notifications',
    tool: 'devdb',
    roles: ['db-schema'],
    scope: { databases: ['notifications', 'audit'] },
  },
  {
    instanceName: 'github-enterprise',
    tool: 'github',
    roles: ['code-reader'],
    scope: { host: 'github.example.com' },
  },
];

describe('resolveInstance', () => {
  it('selects oracle instance by db', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'ORDERS' })?.instanceName)
      .toBe('oracle-orders');
  });

  it('selects devdb instance by db', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'notifications' })?.instanceName)
      .toBe('devdb-notifications');
  });

  it('maps audit to devdb instance', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'audit' })?.instanceName)
      .toBe('devdb-notifications');
  });

  it('selects github instance by host', () => {
    expect(resolveInstance(fixtures, 'code-reader', { host: 'github.example.com' })?.instanceName)
      .toBe('github-enterprise');
  });

  it('returns null when no match', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'unknown_db' })).toBeNull();
  });

  it('excludes instance that does not support the role', () => {
    // devdb-notifications has no db-stored-proc role
    expect(resolveInstance(fixtures, 'db-stored-proc', { database: 'notifications' })).toBeNull();
  });
});

describe('mcpToolPrefix', () => {
  it('generates prefix from tool name', () => {
    expect(mcpToolPrefix(fixtures[0])).toBe('mcp__oracle__');
    expect(mcpToolPrefix(fixtures[1])).toBe('mcp__devdb__');
  });
});
