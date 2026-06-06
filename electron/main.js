const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const waitOn = require('wait-on');

let mainWindow;
let nextProcess;
let apiProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 960,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    titleBarStyle: 'hiddenInset', // Looks good on Mac
  });

  // Load Next.js localhost
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function startServers() {
  const isDev = process.env.NODE_ENV !== 'production';

  const env = { ...process.env };
  const home = process.env.HOME || process.env.USERPROFILE;
  env.PATH = `${env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${home}/.local/bin:${home}/.asdf/shims:${home}/Library/Python/3.14/bin`;

  console.log('Starting Python API...');
  apiProcess = spawn('pnpm', ['run', 'dev:api'], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'inherit',
    env: env
  });

  console.log('Starting Next.js App...');
  const nextCmd = isDev ? 'dev:web' : 'start';
  nextProcess = spawn('pnpm', ['run', nextCmd], {
    cwd: path.join(__dirname, '..'),
    shell: true,
    stdio: 'inherit',
    env: env
  });

  waitOn({
    resources: ['http://localhost:3000', 'http-get://localhost:8001/lang/config'],
    timeout: 60000,
  }).then(() => {
    console.log('Servers are up, opening window...');
    createWindow();
  }).catch((err) => {
    console.error('Failed to wait for servers:', err);
    app.quit();
  });
}

app.on('ready', startServers);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('quit', () => {
  if (nextProcess) {
    nextProcess.kill();
  }
  if (apiProcess) {
    apiProcess.kill();
  }
});
