const assert = require('node:assert/strict');
const test = require('node:test');

const { createFolderSelector } = require('./folder-dialog');

test('opens a directory picker attached to the active LocalWiki window', async () => {
  const parentWindow = { id: 7 };
  const calls = [];
  const selector = createFolderSelector({
    dialog: {
      async showOpenDialog(parent, options) {
        calls.push({ parent, options });
        return { canceled: false, filePaths: ['/projects/local-wiki'] };
      },
    },
    getParentWindow: () => parentWindow,
  });

  const result = await selector.selectFolder();

  assert.deepEqual(result, { cancelled: false, path: '/projects/local-wiki' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, parentWindow);
  assert.deepEqual(calls[0].options.properties, ['openDirectory', 'createDirectory']);
});

test('treats closing the native picker as a recoverable cancellation', async () => {
  const selector = createFolderSelector({
    dialog: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      },
    },
    getParentWindow: () => null,
  });

  assert.deepEqual(await selector.selectFolder(), { cancelled: true, path: '' });
});

test('coalesces repeated requests while the native picker is open', async () => {
  let resolveDialog;
  let callCount = 0;
  const selector = createFolderSelector({
    dialog: {
      showOpenDialog() {
        callCount += 1;
        return new Promise((resolve) => {
          resolveDialog = resolve;
        });
      },
    },
    getParentWindow: () => null,
  });

  const first = selector.selectFolder();
  const second = selector.selectFolder();
  resolveDialog({ canceled: false, filePaths: ['/projects/shared'] });

  assert.deepEqual(await first, { cancelled: false, path: '/projects/shared' });
  assert.deepEqual(await second, { cancelled: false, path: '/projects/shared' });
  assert.equal(callCount, 1);
});
