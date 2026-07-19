import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));
const scripts = packageMetadata.scripts ?? {};
const failures = [];

if (packageMetadata.build?.directories?.output !== 'dist') {
  failures.push('build.directories.output must be exactly "dist"');
}
if (!scripts['desktop:build']?.includes('release:desktop')) {
  failures.push('desktop:build must remain an alias of release:desktop');
}
for (const requiredStep of ['check:release', 'check:repo', 'test:desktop', 'desktop:clean', 'desktop:prepare', 'package-desktop.mjs']) {
  if (!scripts['release:desktop']?.includes(requiredStep)) {
    failures.push(`release:desktop is missing required step: ${requiredStep}`);
  }
}
if (scripts['release:desktop']?.indexOf('desktop:clean') > scripts['release:desktop']?.indexOf('desktop:prepare')) {
  failures.push('release:desktop must clean previous output before desktop:prepare');
}

const trackedOutputs = execFileSync(
  'git',
  ['ls-files', '-z', '--', 'dist', 'dist-electron*'],
  { encoding: 'utf8' },
).split('\0').filter(Boolean);
if (trackedOutputs.length > 0) {
  failures.push(`desktop outputs are tracked: ${trackedOutputs.join(', ')}`);
}

if (failures.length > 0) {
  console.error('Desktop release contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Desktop release contract passed (latest-only output: dist/).');
