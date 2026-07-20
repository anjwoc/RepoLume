const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const { mkdirSync, appendFileSync } = require('fs');
const net = require('net');
const path = require('path');
const { FOLDER_DIALOG_CHANNEL, createFolderSelector } = require('./folder-dialog');
const { PRIVACY_SETTINGS_CHANNEL, createPrivacySettingsOpener } = require('./privacy-settings');
const { ServiceSupervisor } = require('./service-supervisor');
const { preferredPort } = require('./runtime-config');
const { prepareUserDataDirectory } = require('./brand-migration');

let mainWindow = null;
let webService = null;
let apiService = null;
let webPort = null;
let quitting = false;
const folderSelector = createFolderSelector({
  dialog,
  getParentWindow: () => BrowserWindow.getFocusedWindow() || mainWindow,
});
const openPrivacySettings = createPrivacySettingsOpener({ platform: process.platform, shell });

const userDataMigration = prepareUserDataDirectory(app.getPath('appData'));
app.setPath('userData', userDataMigration.current);

function productEnv(name, fallback) {
  return process.env[`REPOLUME_${name}`]
    ?? process.env[`LOCALWIKI_${name}`]
    ?? fallback;
}

function findAvailablePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', (error) => {
      if (error.code !== 'EADDRINUSE') {
        reject(error);
        return;
      }
      server.listen(0, '127.0.0.1');
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : preferredPort;
      server.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function logChild(name, child) {
  const logFile = path.join(app.getPath('userData'), `${name}.log`);
  const log = (chunk, isErr) => {
    const msg = `[${name}] ${chunk.toString().trimEnd()}`;
    if (isErr) console.error(msg);
    else console.log(msg);
    try { appendFileSync(logFile, msg + '\n'); } catch {}
  };
  child.stdout?.on('data', (chunk) => log(chunk, false));
  child.stderr?.on('data', (chunk) => log(chunk, true));
  child.on('exit', (code, signal) => {
    if (!quitting && code !== 0) {
      const msg = `${name} exited unexpectedly { code: ${code}, signal: ${signal} }`;
      console.error(msg);
      try { appendFileSync(logFile, msg + '\n'); } catch {}
    }
  });
}

function startChild(name, executable, args, options) {
  const child = spawn(executable, args, {
    ...options,
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logChild(name, child);
  return child;
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function stopServers() {
  quitting = true;
  webService?.stop();
  apiService?.stop();
  webService = null;
  apiService = null;
}

function showCrashLoop({ name, reason, restarts }) {
  const detail = `${name} service stopped after ${restarts} restart attempts. ${JSON.stringify(reason)}`;
  console.error('RepoLume service crash loop', detail);
  if (process.argv.includes('--smoke-test')) {
    try {
      const logFile = path.join(app.getPath('userData'), `${name}.log`);
      console.error(`--- ${name}.log ---\n` + require('fs').readFileSync(logFile, 'utf8'));
    } catch {}
    app.exit(1);
  } else {
    dialog.showErrorBox('RepoLume service stopped', detail);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 960,
    minWidth: 900,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });
  mainWindow.loadURL(`http://127.0.0.1:${webPort}`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startServers() {
  const projectRoot = path.join(__dirname, '..');
  const packaged = app.isPackaged;
  const resourcesRoot = packaged ? process.resourcesPath : projectRoot;
  const executableSuffix = process.platform === 'win32' ? '.exe' : '';
  const preferredApiPort = preferredPort(productEnv('API_PORT'), 8001);
  const apiPort = await findAvailablePort(preferredApiPort);
  if (apiPort !== preferredApiPort) {
    throw new Error(`RepoLume API port ${preferredApiPort} is already in use`);
  }
  webPort = await findAvailablePort(preferredPort(productEnv('WEB_PORT'), 3000));
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const cacheRoot = path.join(app.getPath('userData'), 'cache');
  const wikiOutRoot = productEnv('WIKI_OUT_DIR')
    || path.join(app.getPath('userData'), 'artifacts');
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });
  mkdirSync(wikiOutRoot, { recursive: true });

  const home = process.env.HOME || process.env.USERPROFILE || '';
  const pathEntries = [
    process.env.PATH || '',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    home ? path.join(home, '.local', 'bin') : '',
  ].filter(Boolean);
  const env = {
    ...process.env,
    PATH: pathEntries.join(path.delimiter),
    NODE_ENV: 'production',
    SERVER_BASE_URL: `http://127.0.0.1:${apiPort}`,
    REPOLUME_DATA_DIR: dataRoot,
    REPOLUME_CACHE_DIR: cacheRoot,
    REPOLUME_WIKI_OUT_DIR: wikiOutRoot,
    PORT: String(apiPort),
    PYTHONUNBUFFERED: '1',
  };

  if (packaged) {
    const agentExecutable = path.join(
      resourcesRoot,
      'bin',
      `repolume-agent${executableSuffix}`,
    );
    env.REPOLUME_AGENT_BIN = agentExecutable;
    const apiExecutable = path.join(
      resourcesRoot,
      'api',
      'repolume-api',
      `repolume-api${executableSuffix}`,
    );
    const webRoot = path.join(resourcesRoot, 'web');
    apiService = new ServiceSupervisor({
      name: 'api',
      launch: () => startChild('api', apiExecutable, [], {
        cwd: dataRoot,
        env,
        windowsHide: true,
      }),
      stopChild,
      probe: () => waitForUrl(`http://127.0.0.1:${apiPort}/lang/config`, 15_000),
      onCrashLoop: showCrashLoop,
    });
    webService = new ServiceSupervisor({
      name: 'web',
      launch: () => startChild('web', process.execPath, ['server.js'], {
        cwd: webRoot,
        env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: `${path.join(webRoot, 'runtime_modules')}${path.delimiter}${path.join(webRoot, 'runtime_modules', '.pnpm', 'node_modules')}`,
        PORT: String(webPort),
          HOSTNAME: '127.0.0.1',
        },
        windowsHide: true,
      }),
      stopChild,
      probe: () => waitForUrl(`http://127.0.0.1:${webPort}`, 15_000),
      onCrashLoop: showCrashLoop,
    });
  } else {
    const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    apiService = new ServiceSupervisor({
      name: 'api',
      launch: () => startChild('api', pnpm, ['run', 'dev:api'], {
        cwd: projectRoot,
        env: { ...env, NODE_ENV: 'development', PORT: String(apiPort) },
      }),
      stopChild,
      probe: () => waitForUrl(`http://127.0.0.1:${apiPort}/lang/config`, 15_000),
      onCrashLoop: showCrashLoop,
    });
    webService = new ServiceSupervisor({
      name: 'web',
      launch: () => startChild(
        'web',
        pnpm,
        ['run', 'dev:web', '--', '--port', String(webPort)],
        {
          cwd: projectRoot,
          env: { ...env, NODE_ENV: 'development' },
        },
      ),
      stopChild,
      probe: () => waitForUrl(`http://127.0.0.1:${webPort}`, 15_000),
      onCrashLoop: showCrashLoop,
    });
  }

  apiService.start();
  webService.start();

  await Promise.all([
    waitForUrl(`http://127.0.0.1:${apiPort}/lang/config`),
    waitForUrl(`http://127.0.0.1:${webPort}`),
  ]);
  if (process.argv.includes('--smoke-test')) {
    console.log('REPOLUME_DESKTOP_SMOKE_READY');
    setImmediate(() => app.quit());
  } else {
    createWindow();
  }
}

app.whenReady().then(() => {
  ipcMain.handle(FOLDER_DIALOG_CHANNEL, () => folderSelector.selectFolder());
  ipcMain.handle(PRIVACY_SETTINGS_CHANNEL, () => openPrivacySettings());
  return startServers();
}).catch((error) => {
  console.error('RepoLume startup failed', error);
  if (process.argv.includes('--smoke-test')) {
    ['api', 'web'].forEach(name => {
      try { console.error(`--- ${name}.log ---\n` + require('fs').readFileSync(path.join(app.getPath('userData'), `${name}.log`), 'utf8')); } catch {}
    });
    app.exit(1);
  }
  stopServers();
  app.quit();
});

app.on('before-quit', stopServers);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (mainWindow === null && webPort !== null) createWindow();
});
