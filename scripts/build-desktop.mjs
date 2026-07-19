import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { arch, platform } from 'node:process';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createStandaloneCopyFilter } from './desktop-copy-filter.mjs';

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
  '-o', join(desktopRoot, 'bin', `localwiki-agent${executableSuffix}`),
  './cmd/localwiki-agent',
], {
  cwd: join(projectRoot, 'agent'),
  env: { GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
});

run('poetry', [
  '-C', 'api',
  'run', 'pyinstaller',
  '--noconfirm',
  '--clean',
  '--distpath', '../build/desktop/api',
  '--workpath', '../build/pyinstaller',
  'localwiki-api.spec',
]);

run('pnpm', ['build']);

const standaloneRoot = join(projectRoot, '.next', 'standalone');
if (!existsSync(join(standaloneRoot, 'server.js'))) {
  throw new Error('Next.js standalone server was not generated');
}

const webRoot = join(desktopRoot, 'web');
cpSync(standaloneRoot, webRoot, {
  recursive: true,
  verbatimSymlinks: true,
  filter: createStandaloneCopyFilter(standaloneRoot),
});
renameSync(join(webRoot, 'node_modules'), join(webRoot, 'runtime_modules'));
cpSync(join(projectRoot, '.next', 'static'), join(webRoot, '.next', 'static'), {
  recursive: true,
});
cpSync(join(projectRoot, 'public'), join(webRoot, 'public'), { recursive: true });

const apiExecutable = join(
  desktopRoot,
  'api',
  'localwiki-api',
  `localwiki-api${executableSuffix}`,
);
if (!existsSync(apiExecutable)) {
  throw new Error(`Bundled API executable is missing: ${apiExecutable}`);
}
