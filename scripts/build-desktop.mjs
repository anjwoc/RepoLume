import { cpSync, existsSync, mkdirSync, renameSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { arch, platform } from 'node:process';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createPublicCopyFilter, createStandaloneCopyFilter } from './desktop-copy-filter.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const desktopRoot = join(projectRoot, 'build', 'desktop');
const pyinstallerRoot = join(projectRoot, 'build', 'pyinstaller');
const executableSuffix = platform === 'win32' ? '.exe' : '';
const goos = platform === 'win32' ? 'windows' : platform;
const goarch = arch === 'x64' ? 'amd64' : arch;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, ...options.env },
    shell: platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

rmSync(desktopRoot, { recursive: true, force: true });
rmSync(pyinstallerRoot, { recursive: true, force: true });
mkdirSync(join(desktopRoot, 'bin'), { recursive: true });
mkdirSync(join(desktopRoot, 'api'), { recursive: true });

run('go', [
  'build',
  '-trimpath',
  '-o', join(desktopRoot, 'bin', `repolume-agent${executableSuffix}`),
  './cmd/repolume-agent',
], {
  cwd: join(projectRoot, 'apps', 'api', 'agent'),
  env: { GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
});

run('poetry', [
  '-C', 'apps/api/api',
  'run', 'pyinstaller',
  '--noconfirm',
  '--clean',
  '--distpath', '../../../build/desktop/api',
  '--workpath', '../../../build/pyinstaller',
  'repolume-api.spec',
]);

run('pnpm', ['build']);

const standaloneRoot = join(projectRoot, 'apps/web/.next/standalone');
if (!existsSync(join(standaloneRoot, 'apps/web/server.js'))) {
  throw new Error('Next.js standalone server was not generated');
}

const webRoot = join(desktopRoot, 'web');
cpSync(join(standaloneRoot, 'apps/web'), webRoot, {
  recursive: true,
  verbatimSymlinks: true,
  filter: createStandaloneCopyFilter(join(standaloneRoot, 'apps/web')),
});
cpSync(join(standaloneRoot, 'node_modules'), join(webRoot, 'runtime_modules'), {
  recursive: true,
  verbatimSymlinks: true,
});

function removeBrokenSymlinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(fullPath)) {
        rmSync(fullPath);
      }
    } else if (entry.isDirectory()) {
      removeBrokenSymlinks(fullPath);
    }
  }
}
removeBrokenSymlinks(join(webRoot, 'runtime_modules'));
cpSync(join(projectRoot, 'apps', 'web', '.next', 'static'), join(webRoot, '.next', 'static'), {
  recursive: true,
});
const publicRoot = join(projectRoot, 'apps', 'web', 'public');
cpSync(publicRoot, join(webRoot, 'public'), {
  recursive: true,
  filter: createPublicCopyFilter(publicRoot),
});

const apiExecutable = join(
  desktopRoot,
  'api',
  'repolume-api',
  `repolume-api${executableSuffix}`,
);
if (!existsSync(apiExecutable)) {
  throw new Error(`Bundled API executable is missing: ${apiExecutable}`);
}
