import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const trackedFiles = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);

const allowedTopLevelDirectories = new Set([
  '.github',
  'agent',
  'api',
  'cli',
  'config',
  'docker',
  'docs',
  'e2e',
  'electron',
  'flows',
  'public',
  'scripts',
  'src',
  'tests',
]);
const allowedTopLevelFiles = new Set([
  '.dockerignore',
  '.env.example',
  '.gitignore',
  '.npmignore',
  '.npmrc',
  '.python-version',
  '.vercelignore',
  'CHANGELOG.md',
  'CODE_OF_CONDUCT.md',
  'CONTRIBUTING.md',
  'Dockerfile',
  'LICENSE',
  'Makefile',
  'NOTICE',
  'README.kr.md',
  'README.md',
  'SECURITY.md',
  'components.json',
  'docker-compose.yml',
  'eslint.config.mjs',
  'next.config.ts',
  'package.json',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'postcss.config.mjs',
  'pytest.ini',
  'tailwind.config.js',
  'tsconfig.json',
  'vercel.json',
  'vitest.config.ts',
]);

const forbiddenPaths = [
  /^(?:build|dist|dist-electron[^/]*)(?:\/|$)/,
  /^(?:\.antigravitycli|\.codegraph|\.localwiki-cache|\.proofloop|\.vscode)(?:\/|$)/,
  /^(?:api\/data|api\/graphify-out|benchmark-out|test-results|public\/showcase-data)(?:\/|$)/,
  /^docs\/(?:business-flow-prompts|plans|superpowers)(?:\/|$)/,
  /^api\/scratch_.*\.md$/,
  /(?:^|\/)[^/]+\.db(?:-wal|-shm)?$/,
];

const privateMarkers = /gmarket|linkrew|clouz|udvora|s_gaffiliate|jaecjeong/i;
const secretMarkers = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /sk-[A-Za-z0-9_-]{20,}/,
];
const absoluteUserPath = /(?:\/Users|\/home)\/[A-Za-z0-9._-]+\//;

const failures = [];
for (const file of trackedFiles) {
  const [topLevel] = file.split('/');
  const allowedAtRoot = file.includes('/')
    ? allowedTopLevelDirectories.has(topLevel)
    : allowedTopLevelFiles.has(file);
  if (!allowedAtRoot) {
    failures.push(`${file}: path is outside the public repository allowlist`);
    continue;
  }

  if (forbiddenPaths.some(pattern => pattern.test(file))) {
    failures.push(`${file}: generated or private path is tracked`);
    continue;
  }

  let content;
  try {
    const buffer = readFileSync(file);
    if (buffer.length > 5_000_000 || buffer.includes(0)) continue;
    content = buffer.toString('utf8');
  } catch {
    continue;
  }

  if (file !== 'scripts/check-repository-hygiene.mjs' && privateMarkers.test(content)) {
    failures.push(`${file}: private organization marker detected`);
  }
  if (absoluteUserPath.test(content)) failures.push(`${file}: absolute user path detected`);
  if (secretMarkers.some(pattern => pattern.test(content))) failures.push(`${file}: credential-like value detected`);
}

if (failures.length > 0) {
  console.error('Repository hygiene check failed:');
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Repository hygiene check passed (${trackedFiles.length} tracked files).`);
