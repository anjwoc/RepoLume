import { execFileSync } from 'node:child_process';

const output = execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { encoding: 'utf8' },
);
const pack = JSON.parse(output)[0];
const paths = pack.files.map(file => file.path);
const forbidden = paths.filter(path => (
  /^(?:build|dist|dist-electron[^/]*|backend|bin|wiki-out)(?:\/|$)/.test(path)
  || /^(?:api\/data|benchmark-out|test-results|public\/showcase-data)(?:\/|$)/.test(path)
  || /^(?:\.proofloop|\.codegraph|\.repolume-cache|\.localwiki-cache)(?:\/|$)/.test(path)
  || (/^\.env(?:\.|$)/.test(path) && path !== '.env.example')
  || /\.db(?:-wal|-shm)?$/.test(path)
));

if (forbidden.length > 0) {
  console.error('Package content check failed:');
  for (const path of forbidden.sort()) console.error(`- ${path}`);
  process.exit(1);
}

console.log(
  `Package content check passed (${pack.entryCount} files, ${pack.unpackedSize} unpacked bytes).`,
);
