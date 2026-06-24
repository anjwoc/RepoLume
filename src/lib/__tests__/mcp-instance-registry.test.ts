import { describe, it, expect } from 'vitest';
import { resolveInstance, mcpToolPrefix, McpInstance } from '../mcp-instance-registry';

const fixtures: McpInstance[] = [
  {
    instanceName: 'oracle-gaffiliate',
    tool: 'oracle',
    roles: ['db-schema', 'db-stored-proc', 'db-query'],
    scope: { databases: ['O_GAFFILIATE'] },
  },
  {
    instanceName: 'devdb-nautomaildb',
    tool: 'devdb',
    roles: ['db-schema'],
    scope: { databases: ['nautomaildb', 'neption'] },
  },
  {
    instanceName: 'github-enterprise',
    tool: 'github',
    roles: ['code-reader'],
    scope: { host: 'github.gmarket.com' },
  },
];

describe('resolveInstance', () => {
  it('selects oracle instance by db', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'O_GAFFILIATE' })?.instanceName)
      .toBe('oracle-gaffiliate');
  });

  it('selects devdb instance by db', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'nautomaildb' })?.instanceName)
      .toBe('devdb-nautomaildb');
  });

  it('maps neption to devdb instance', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'neption' })?.instanceName)
      .toBe('devdb-nautomaildb');
  });

  it('selects github instance by host', () => {
    expect(resolveInstance(fixtures, 'code-reader', { host: 'github.gmarket.com' })?.instanceName)
      .toBe('github-enterprise');
  });

  it('returns null when no match', () => {
    expect(resolveInstance(fixtures, 'db-schema', { database: 'unknown_db' })).toBeNull();
  });

  it('excludes instance that does not support the role', () => {
    // devdb-nautomaildb has no db-stored-proc role
    expect(resolveInstance(fixtures, 'db-stored-proc', { database: 'nautomaildb' })).toBeNull();
  });
});

describe('mcpToolPrefix', () => {
  it('generates prefix from tool name', () => {
    expect(mcpToolPrefix(fixtures[0])).toBe('mcp__oracle__');
    expect(mcpToolPrefix(fixtures[1])).toBe('mcp__devdb__');
  });
});
