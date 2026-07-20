import { describe, expect, it } from 'vitest';

import { isSourceFilePath, repairSourceUrl, resolveSourceLink, type GitRoot } from '../source-link-resolver';

const roots: GitRoot[] = [
  {
    prefix: 'packages/indexer',
    name: 'indexer',
    localPath: '/workspace/grok-build/packages/indexer',
    webUrl: 'https://github.com/acme/indexer',
    branch: 'develop',
    files: ['src/language-registry.ts', 'src/index.ts'],
  },
];

describe('isSourceFilePath', () => {
  it('does not treat language extension labels as source files', () => {
    expect(isSourceFilePath('.ts')).toBe(false);
    expect(isSourceFilePath('.tsx')).toBe(false);
    expect(isSourceFilePath('.go')).toBe(false);
  });

  it('accepts real source file paths', () => {
    expect(isSourceFilePath('packages/indexer/src/index.ts')).toBe(true);
    expect(isSourceFilePath('LanguageRegistry.ts')).toBe(true);
  });
});

describe('resolveSourceLink', () => {
  it('maps a project-relative path through the matching nested git root', () => {
    expect(resolveSourceLink('packages/indexer/src/language-registry.ts', roots, 'blob')).toBe(
      'https://github.com/acme/indexer/blob/develop/src/language-registry.ts',
    );
  });

  it('maps an absolute local path by the git root localPath', () => {
    expect(resolveSourceLink('/workspace/grok-build/packages/indexer/src/index.ts:42', roots, 'blob')).toBe(
      'https://github.com/acme/indexer/blob/develop/src/index.ts#L42',
    );
  });

  it('resolves a unique tracked-file suffix but rejects a missing path', () => {
    expect(resolveSourceLink('language-registry.ts', roots, 'blob')).toBe(
      'https://github.com/acme/indexer/blob/develop/src/language-registry.ts',
    );
    expect(resolveSourceLink('missing.ts', roots, 'blob')).toBe('');
  });

  it('repairs a stale parent-repository URL with the tracked nested repository', () => {
    expect(repairSourceUrl(
      'https://github.com/acme/grok-build/blob/main/packages/indexer/src/index.ts',
      roots,
    )).toBe('https://github.com/acme/indexer/blob/develop/src/index.ts');
  });

  it('marks known missing and bare-extension source URLs as non-clickable', () => {
    expect(repairSourceUrl(
      'https://github.com/acme/indexer/blob/develop/src/missing.ts',
      roots,
    )).toBe('');
    expect(repairSourceUrl(
      'https://github.com/acme/indexer/blob/develop/.ts',
      roots,
    )).toBe('');
  });

  it('leaves unrelated repository links untouched', () => {
    expect(repairSourceUrl(
      'https://github.com/other/project/blob/main/src/index.ts',
      roots,
    )).toBeNull();
  });

  it('does not guess when a short path exists in multiple repositories', () => {
    const duplicateRoots: GitRoot[] = [
      ...roots,
      { ...roots[0], prefix: 'packages/other', name: 'other', webUrl: 'https://github.com/acme/other' },
    ];

    expect(resolveSourceLink('src/index.ts', duplicateRoots, 'blob')).toBe('');
  });
});
