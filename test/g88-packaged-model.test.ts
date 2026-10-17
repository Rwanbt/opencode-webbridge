import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('G88 missing native RPC refuses model completion; unauthenticated local inference denied', async () => {
  const { modelBridge, receiptText } = await import(
    new URL('../../scripts/smoke-packaged-model.mjs', import.meta.url).href);
  assert.equal(receiptText('f'.repeat(64), 'g88_nonce_test_01').startsWith('G88_PACKAGED_RPC_MODEL_PROOF_'), true);
  assert.throws(() => receiptText('weak', 'g88_nonce_test_01'), /invalid/);
  assert.throws(() => receiptText('f'.repeat(64), '../out'), /invalid/);
  const temp = await mkdtemp(join(tmpdir(), 'g88-test-negative-'));
  let fixture;
  try {
    fixture = await modelBridge.prepare({ temp, version: '0.0.1' });
    const url = fixture.env.WEBBRIDGE_FIXTURE_URL;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const payload = JSON.stringify({ model: 'webbridge-native-fixture', stream: true,
      messages: [{ role: 'user', content:
        'G88_REMOTE_MODEL_PROMPT: offline model via installed local RPC, no tools.' }] });
    const missingAuth = await fetch(url + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
      signal: AbortSignal.timeout(2000) });
    assert.equal(missingAuth.status, 401);
    const noNativeRPC = await fetch(url + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: 'Bearer ' + fixture.env.WEBBRIDGE_FIXTURE_TOKEN },
      body: payload, signal: AbortSignal.timeout(2000) });
    assert.equal(noNativeRPC.status, 503);
  } finally {
    await fixture?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
