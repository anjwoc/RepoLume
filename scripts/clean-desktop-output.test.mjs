import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanDesktopOutputs } from './clean-desktop-output.mjs';

test('removes the current dist directory and legacy dist-electron variants only', () => {
  const root = mkdtempSync(join(tmpdir(), 'repolume-desktop-clean-'));
  try {
    for (const name of ['dist', 'dist-electron', 'dist-electron-permission-v2', 'distillery']) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'marker.txt'), name);
    }

    const removed = cleanDesktopOutputs(root, () => {});

    assert.deepEqual(removed.sort(), [
      'dist',
      'dist-electron',
      'dist-electron-permission-v2',
    ]);
    assert.equal(existsSync(join(root, 'dist')), false);
    assert.equal(existsSync(join(root, 'dist-electron')), false);
    assert.equal(existsSync(join(root, 'dist-electron-permission-v2')), false);
    assert.equal(existsSync(join(root, 'distillery', 'marker.txt')), true);
    assert.equal(existsSync(join(root, 'build', '.desktop-output-trash')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
