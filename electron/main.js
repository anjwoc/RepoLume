const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn, spawnSync } = require('child_process');
const { mkdirSync } = require('fs');
const net = require('net');
const path = require('path');
const { FOLDER_DIALOG_CHANNEL, createFolderSelector } = require('./folder-dialog');
const { PRIVACY_SETTINGS_CHANNEL, createPrivacySettingsOpener } = require('./privacy-settings');
const { ServiceSupervisor } = require('./service-supervisor');
const { preferredPort } = require('./runtime-config');

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
  child.stdout?.on('data', (chunk) => console.log(`[${name}] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk) => console.error(`[${name}] ${chunk.toString().trimEnd()}`));
  child.on('exit', (code, signal) => {
    if (!quitting && code !== 0) {
      console.error(`${name} exited unexpectedly`, { code, signal });
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
  console.error('LocalWiki service crash loop', detail);
  dialog.showErrorBox('LocalWiki service stopped', detail);
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
  const preferredApiPort = preferredPort(process.env.LOCALWIKI_API_PORT, 8001);
  const apiPort = await findAvailablePort(preferredApiPort);
  if (apiPort !== preferredApiPort) {
    throw new Error(`LocalWiki API port ${preferredApiPort} is already in use`);
  }
  webPort = await findAvailablePort(preferredPort(process.env.LOCALWIKI_WEB_PORT, 3000));
  const dataRoot = path.join(app.getPath('userData'), 'data');
  const cacheRoot = path.join(app.getPath('userData'), 'cache');
  const wikiOutRoot = process.env.LOCALWIKI_WIKI_OUT_DIR
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
    LOCALWIKI_DATA_DIR: dataRoot,
    LOCALWIKI_CACHE_DIR: cacheRoot,
    LOCALWIKI_WIKI_OUT_DIR: wikiOutRoot,
    PORT: String(apiPort),
    PYTHONUNBUFFERED: '1',
  };

  if (packaged) {
    const agentExecutable = path.join(
      resourcesRoot,
      'bin',
      `localwiki-agent${executableSuffix}`,
    );
    env.LOCALWIKI_AGENT_BIN = agentExecutable;
    const apiExecutable = path.join(
      resourcesRoot,
      'api',
      'localwiki-api',
      `localwiki-api${executableSuffix}`,
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
        NODE_PATH: path.join(webRoot, 'runtime_modules'),
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
    console.log('LOCALWIKI_DESKTOP_SMOKE_READY');
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
  console.error('LocalWiki startup failed', error);
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
