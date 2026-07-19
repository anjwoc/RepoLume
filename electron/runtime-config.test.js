const test = require('node:test');
const assert = require('node:assert/strict');

const { preferredPort } = require('./runtime-config');

test('uses configured ports when they are valid', () => {
  assert.equal(preferredPort('8201', 8001), 8201);
});

test('falls back for missing, non-numeric, or out-of-range ports', () => {
  assert.equal(preferredPort(undefined, 8001), 8001);
  assert.equal(preferredPort('abc', 8001), 8001);
  assert.equal(preferredPort('70000', 8001), 8001);
});
