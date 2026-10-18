import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';

test('G81 self-contained packaged RPC registers only by explicit test opt-in', async () => {
  const { default: plugin } = await import(new URL('../../fixtures/g81-rpc-preview.mjs', import.meta.url).href);
  const oldFlag = process.env.WEBBRIDGE_G81_TEST_ONLY;
  const oldSecret = process.env.WEBBRIDGE_G81_SECRET;
  let calls = 0;
  let disposed = 0;
  let challenge!: (value: Record<string, unknown>) => Promise<{ receipt: string }>;
  const context = { rpc: { register: async (contract: { id: string; methods: Record<string, unknown> },
    handlers: { challenge: typeof challenge }) => {
    calls++;
    assert.equal(contract.id, 'webbridge-g81-package');
    assert.deepEqual(Object.keys(contract.methods), ['challenge']);
    challenge = handlers.challenge;
    return { dispose: () => { disposed++; } };
  } } };
  try {
    delete process.env.WEBBRIDGE_G81_TEST_ONLY;
    await plugin.setup(context);
    assert.equal(calls, 0);
    process.env.WEBBRIDGE_G81_TEST_ONLY = '1';
    delete process.env.WEBBRIDGE_G81_SECRET;
    await assert.rejects(plugin.setup(context), /capability missing/);
    assert.equal(calls, 0);
    const secret = 'f'.repeat(64);
    process.env.WEBBRIDGE_G81_SECRET = secret;
    const cleanup = await plugin.setup(context);
    assert.equal(calls, 1);
    const fixture = { secret, scope: 'g81-local-profile', nonce: 'nonce_unique_1' };
    await assert.rejects(challenge({ ...fixture, scope: 'foreign' }), /denied/);
    await assert.rejects(challenge({ ...fixture, secret: '0'.repeat(64) }), /denied/);
    await assert.rejects(challenge({ ...fixture, nonce: '../path' }), /denied/);
    assert.deepEqual(await challenge(fixture),
      { receipt: createHmac('sha256', secret).update(fixture.nonce).digest('hex') });
    await assert.rejects(challenge(fixture), /replay denied/);
    await cleanup?.();
    assert.equal(disposed, 1);
  } finally {
    if (oldFlag === undefined) delete process.env.WEBBRIDGE_G81_TEST_ONLY;
    else process.env.WEBBRIDGE_G81_TEST_ONLY = oldFlag;
    if (oldSecret === undefined) delete process.env.WEBBRIDGE_G81_SECRET;
    else process.env.WEBBRIDGE_G81_SECRET = oldSecret;
  }
});
