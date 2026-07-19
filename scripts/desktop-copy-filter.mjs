import { relative, sep } from 'node:path';

const EXCLUDED_TOP_LEVEL_ENTRIES = new Set(['build', 'dist', 'public', 'wiki-out']);
const PUBLIC_RELEASE_FILES = new Set([
  'file.svg',
  'globe.svg',
  'next.svg',
  'repolume-mark.svg',
  'vercel.svg',
  'window.svg',
]);

export function createStandaloneCopyFilter(standaloneRoot) {
  return (sourcePath) => {
    const relativePath = relative(standaloneRoot, sourcePath);
    if (!relativePath) return true;
    const topLevelEntry = relativePath.split(sep)[0];
    return !EXCLUDED_TOP_LEVEL_ENTRIES.has(topLevelEntry)
      && !topLevelEntry.startsWith('dist-electron');
  };
}

export function createPublicCopyFilter(publicRoot) {
  return (sourcePath) => {
    const relativePath = relative(publicRoot, sourcePath);
    return !relativePath || PUBLIC_RELEASE_FILES.has(relativePath);
  };
}
