import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { createStandaloneCopyFilter } from './desktop-copy-filter.mjs';

test('excludes recursive build artifacts and generated wiki output', () => {
  const root = resolve('/tmp/localwiki-standalone');
  const filter = createStandaloneCopyFilter(root);

  assert.equal(filter(root), true);
  assert.equal(filter(resolve(root, 'server.js')), true);
  assert.equal(filter(resolve(root, '.next/server/app.js')), true);
  assert.equal(filter(resolve(root, 'dist-electron/mac-arm64/LocalWiki.app')), false);
  assert.equal(filter(resolve(root, 'dist-electron-hotfix/mac-arm64/LocalWiki.app')), false);
  assert.equal(filter(resolve(root, 'dist-electron-permission/mac-arm64/LocalWiki.app')), false);
  assert.equal(filter(resolve(root, 'build/desktop/web')), false);
  assert.equal(filter(resolve(root, 'wiki-out/project_01/index.md')), false);
});
