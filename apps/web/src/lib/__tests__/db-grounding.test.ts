import { describe, expect, it } from 'vitest';

import { annotateSqlVerification, buildCodebaseDbEvidence } from '../db-grounding';

describe('codebase DB grounding', () => {
  it('labels SQL as code-inferred when DB MCP is unavailable', () => {
    const content = '```sql\nSELECT value FROM meta WHERE key = ?\n```';

    const annotated = annotateSqlVerification(content, new Set(), false);

    expect(annotated).toContain('코드베이스 근거 기반 추론');
    expect(annotated).not.toContain('manual verification required');
  });

  it('builds DB evidence from statically extracted code entities', () => {
    const evidence = buildCodebaseDbEvidence({
      db_tables: ['meta', 'worktrees'],
      stored_procs: ['claim_worktree'],
      source: 'regex',
    });

    expect(evidence).toContain('meta, worktrees');
    expect(evidence).toContain('claim_worktree');
    expect(evidence).toContain('static code scan');
  });
});
