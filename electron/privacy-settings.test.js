const assert = require('node:assert/strict');
const test = require('node:test');

const { createPrivacySettingsOpener, FILES_AND_FOLDERS_SETTINGS_URL } = require('./privacy-settings');

test('opens the macOS Files & Folders privacy pane', async () => {
  const calls = [];
  const openPrivacySettings = createPrivacySettingsOpener({
    platform: 'darwin',
    shell: { openExternal: async (url) => calls.push(url) },
  });

  assert.deepEqual(await openPrivacySettings(), { opened: true });
  assert.deepEqual(calls, [FILES_AND_FOLDERS_SETTINGS_URL]);
});

test('reports unsupported platforms without opening an external URL', async () => {
  let called = false;
  const openPrivacySettings = createPrivacySettingsOpener({
    platform: 'win32',
    shell: { openExternal: async () => { called = true; } },
  });

  assert.deepEqual(await openPrivacySettings(), { opened: false });
  assert.equal(called, false);
});
