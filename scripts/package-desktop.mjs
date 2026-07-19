import { readFileSync } from 'node:fs';
import { arch, platform } from 'node:process';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    shell: platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

if (platform === 'darwin') {
  const targetArch = arch === 'arm64' ? 'arm64' : 'x64';
  const architectureFlag = targetArch === 'arm64' ? '--arm64' : '--x64';
  run('pnpm', ['exec', 'electron-builder', '--mac', 'zip', architectureFlag]);
  run('hdiutil', [
    'create',
    '-volname', packageMetadata.build.productName,
    '-srcfolder', join(
      projectRoot,
      'dist-electron',
      `mac-${targetArch}`,
      `${packageMetadata.build.productName}.app`,
    ),
    '-ov',
    '-format', 'UDZO',
    join(
      projectRoot,
      'dist-electron',
      `${packageMetadata.build.productName}-${packageMetadata.version}-${targetArch}.dmg`,
    ),
  ]);
} else if (platform === 'win32') {
  run('pnpm', ['exec', 'electron-builder', '--win']);
} else {
  throw new Error(`Desktop installer build is not configured for ${platform}`);
}
