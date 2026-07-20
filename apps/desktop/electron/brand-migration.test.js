const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareUserDataDirectory } = require('./brand-migration');

test('migrates the legacy LocalWiki user data directory once', () => {
  const calls = [];
  const existing = new Set(['/app-data/LocalWiki']);
  const fs = {
    existsSync: (target) => existing.has(target),
    cpSync: (source, target, options) => {
      calls.push({ source, target, options });
      existing.add(target);
    },
  };

  const first = prepareUserDataDirectory('/app-data', fs);
  const second = prepareUserDataDirectory('/app-data', fs);

  assert.equal(first.current, '/app-data/RepoLume');
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, '/app-data/LocalWiki');
  assert.equal(calls[0].target, '/app-data/RepoLume');
});
