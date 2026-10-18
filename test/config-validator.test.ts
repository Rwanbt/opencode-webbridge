import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateConfig, defaultConfig } from '../src/core/config-validator.js';

const valid = { enabled: false, providers: [], maxConcurrency: 2, requestTimeoutMs: 5000, logLevel: 'error' };

test('valid config passes', () => {
  const r = validateConfig(valid);
  assert.equal(r.ok, true);
});

test('enabled must be boolean', () => {
  const r = validateConfig({ ...valid, enabled: 'yes' });
  assert.equal(r.ok, false);
});

test('unknown provider rejected', () => {
  const r = validateConfig({ ...valid, providers: ['foo'] });
  assert.equal(r.ok, false);
});

test('concurrency bounds enforced', () => {
  assert.equal(validateConfig({ ...valid, maxConcurrency: 0 }).ok, false);
  assert.equal(validateConfig({ ...valid, maxConcurrency: 17 }).ok, false);
});

test('timeout bounds enforced', () => {
  assert.equal(validateConfig({ ...valid, requestTimeoutMs: 500 }).ok, false);
  assert.equal(validateConfig({ ...valid, requestTimeoutMs: 400000 }).ok, false);
});

test('invalid logLevel rejected', () => {
  assert.equal(validateConfig({ ...valid, logLevel: 'verbose' }).ok, false);
});

test('non-object rejected', () => {
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig('x').ok, false);
  assert.equal(validateConfig([1, 2]).ok, false);
});

test('default config is disabled', () => {
  const c = defaultConfig();
  assert.equal(c.enabled, false);
  assert.deepEqual(c.providers, []);
});
