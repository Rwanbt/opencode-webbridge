import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { requireNativeClientReady, requireEmptyRelayReady, probeNativeClient, validNativeClientProbe } from '../src/testing/native-client-probe.js';
import { resolve } from 'node:path';

test('read-only readiness probe never proceeds when both attempts fail', async () => {
  let calls = 0;
  await assert.rejects(requireNativeClientReady(async () => { calls++; return false; }), /unavailable after 2/);
  assert.equal(calls, 2);
});

test('readiness requires a positive result and stops retrying afterward', async () => {
  let calls = 0;
  await requireNativeClientReady(async () => ++calls === 2);
  assert.equal(calls, 2);
  await assert.rejects(requireNativeClientReady(async () => true, 0), /invalid probe budget/);
});

test('native CLI probe refuses external addresses and invalid budgets before any spawn', async () => {
  for (const url of ['https://127.0.0.1:4000/', 'http://localhost:4000/',
    'http://example.com:4000/', 'http://127.0.0.1:4000/admin', 'http://127.0.0.1:4000/?x=1']) {
    await assert.rejects(probeNativeClient('nonexistent-cli', url, '.', {}), /explicit loopback/);
  }
  await assert.rejects(probeNativeClient('nonexistent-cli', 'http://127.0.0.1:4000/', '.', {}, 60), /invalid probe timeout/);
});

test('a failing native CLI invocation never reports readiness', async () => {
  // The real Node executable does not understand CLI `api`; it exits nonzero.
  const ready = await probeNativeClient(process.execPath, 'http://127.0.0.1:4000/', '.', {});
  assert.equal(ready, false);
});

test('CLI response requires the exact isolated directory and valid data shape', () => {
  const cwd = resolve('fixture-working-dir');
  assert.equal(validNativeClientProbe(JSON.stringify({ location: { directory: cwd }, data: [] }), cwd), true);
  for (const malformed of [
    'not-json', '{}', '[]',
    JSON.stringify({ location: { directory: cwd }, data: 'not an array' }),
    JSON.stringify({ location: { directory: resolve('other') }, data: [] }),
  ]) assert.equal(validNativeClientProbe(malformed, cwd), false);
});

test('relay preparation retries only empty-queue reads and fails closed on exhaustion', async () => {
  let attempts = 0;
  await requireEmptyRelayReady(async () => {
    attempts++;
    if (attempts === 1) throw new Error('simulated transport timeout');
    return { found: false };
  });
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(requireEmptyRelayReady(async () => { attempts++; throw new Error('offline'); }), /unavailable after 3/);
  assert.equal(attempts, 3);
});

test('relay preparation never steals or retries an unexpectedly queued job', async () => {
  let attempts = 0;
  await assert.rejects(requireEmptyRelayReady(async () => {
    attempts++;
    return { found: true, turnID: 'foreign' };
  }), /unexpectedly holds a job/);
  assert.equal(attempts, 1);
  await assert.rejects(requireEmptyRelayReady(async () => ({ arbitrary: true }), 1), /unavailable after 1/);
});
