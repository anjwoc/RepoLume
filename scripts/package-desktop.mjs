import { readFileSync } from 'node:fs';
import { arch, platform } from 'node:process';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanDesktopOutputs, DESKTOP_OUTPUT_DIRECTORY } from './clean-desktop-output.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const packageMetadata = JSON.parse(
  readFileSync(join(projectRoot, 'package.json'), 'utf8'),
);
const configuredOutput = packageMetadata.build?.directories?.output;
if (configuredOutput !== DESKTOP_OUTPUT_DIRECTORY) {
  throw new Error(
    `Desktop output must be ${DESKTOP_OUTPUT_DIRECTORY}/, received ${configuredOutput ?? 'undefined'}`,
  );
}
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

cleanDesktopOutputs(projectRoot);

if (platform === 'darwin') {
  const targetArch = arch === 'arm64' ? 'arm64' : 'x64';
  const architectureFlag = targetArch === 'arm64' ? '--arm64' : '--x64';
  run('pnpm', ['exec', 'electron-builder', '--mac', 'zip', architectureFlag]);
  run('hdiutil', [
    'create',
    '-volname', packageMetadata.build.productName,
    '-srcfolder', join(
      projectRoot,
      DESKTOP_OUTPUT_DIRECTORY,
      `mac-${targetArch}`,
      `${packageMetadata.build.productName}.app`,
    ),
    '-ov',
    '-format', 'UDZO',
    join(
      projectRoot,
      DESKTOP_OUTPUT_DIRECTORY,
      `${packageMetadata.build.productName}-${packageMetadata.version}-${targetArch}.dmg`,
    ),
  ]);
} else if (platform === 'win32') {
  run('pnpm', ['exec', 'electron-builder', '--win']);
} else {
  throw new Error(`Desktop installer build is not configured for ${platform}`);
}
