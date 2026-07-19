import { relative, sep } from 'node:path';

const EXCLUDED_TOP_LEVEL_ENTRIES = new Set(['build', 'wiki-out']);

export function createStandaloneCopyFilter(standaloneRoot) {
  return (sourcePath) => {
    const relativePath = relative(standaloneRoot, sourcePath);
    if (!relativePath) return true;
    const topLevelEntry = relativePath.split(sep)[0];
    return !EXCLUDED_TOP_LEVEL_ENTRIES.has(topLevelEntry)
      && !topLevelEntry.startsWith('dist-electron');
  };
}
