const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');
const { FOLDER_DIALOG_CHANNEL } = require('./folder-dialog');
const { PRIVACY_SETTINGS_CHANNEL } = require('./privacy-settings');

test('loads in an Electron sandbox and exposes the folder picker bridge', async () => {
  const preloadSource = readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  const calls = [];
  let exposed;

  runInNewContext(preloadSource, {
    require(moduleId) {
      if (moduleId !== 'electron') throw new Error(`sandbox module not found: ${moduleId}`);
      return {
        contextBridge: {
          exposeInMainWorld(name, api) {
            exposed = { name, api };
          },
        },
        ipcRenderer: {
          invoke(channel) {
            calls.push(channel);
            return Promise.resolve({ cancelled: true, path: '' });
          },
        },
      };
    },
  });

  assert.equal(exposed.name, 'localwikiDesktop');
  await exposed.api.selectFolder();
  await exposed.api.openPrivacySettings();
  assert.deepEqual(calls, [FOLDER_DIALOG_CHANNEL, PRIVACY_SETTINGS_CHANNEL]);
});
