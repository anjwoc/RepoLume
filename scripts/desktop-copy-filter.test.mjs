import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { createPublicCopyFilter, createStandaloneCopyFilter } from './desktop-copy-filter.mjs';

test('excludes recursive build artifacts and generated wiki output', () => {
  const root = resolve('/tmp/repolume-standalone');
  const filter = createStandaloneCopyFilter(root);

  assert.equal(filter(root), true);
  assert.equal(filter(resolve(root, 'server.js')), true);
  assert.equal(filter(resolve(root, '.next/server/app.js')), true);
  assert.equal(filter(resolve(root, 'public/repolume-mark.svg')), false);
  assert.equal(filter(resolve(root, 'dist/mac-arm64/RepoLume.app')), false);
  assert.equal(filter(resolve(root, 'dist-electron/mac-arm64/RepoLume.app')), false);
  assert.equal(filter(resolve(root, 'dist-electron-hotfix/mac-arm64/RepoLume.app')), false);
  assert.equal(filter(resolve(root, 'dist-electron-permission/mac-arm64/RepoLume.app')), false);
  assert.equal(filter(resolve(root, 'build/desktop/web')), false);
  assert.equal(filter(resolve(root, 'wiki-out/project_01/index.md')), false);
});

test('copies only reviewed public release assets', () => {
  const root = resolve('/tmp/repolume-public');
  const filter = createPublicCopyFilter(root);

  assert.equal(filter(root), true);
  assert.equal(filter(resolve(root, 'repolume-mark.svg')), true);
  assert.equal(filter(resolve(root, 'file.svg')), true);
  assert.equal(filter(resolve(root, 'showcase-data')), false);
  assert.equal(filter(resolve(root, 'showcase-data/private.json')), false);
  assert.equal(filter(resolve(root, 'dbgraph-test.html')), false);
  assert.equal(filter(resolve(root, '.DS_Store')), false);
});
