import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('G97 one standalone artifact registers BOTH native provider and scoped RPC, then disposes', async () => {
  const { default: plugin } = await import(pathToFileURL(resolve('fixtures/g97-combined-preview.mjs')).href);
  const initial = ['WEBBRIDGE_G81_TEST_ONLY', 'WEBBRIDGE_G81_SECRET',
    'WEBBRIDGE_FIXTURE_ENABLE', 'WEBBRIDGE_FIXTURE_TOKEN', 'WEBBRIDGE_FIXTURE_URL']
    .map((key) => [key, process.env[key]] as const);
  let rpcCount = 0;
  let providerCount = 0;
  let disposed = 0;
  let handler!: (input: Record<string, unknown>) => Promise<{ receipt: string }>;
  let registration!: Record<string, unknown>;
  const context = {
      rpc: { register: async (contract: { id: string }, methods: { challenge: typeof handler }) => {
      rpcCount++;
        assert.ok(['webbridge-g81-package', 'webbridge-g99-page'].includes(contract.id));
        if (contract.id === 'webbridge-g81-package') handler = methods.challenge;
      return { dispose: () => { disposed++; } };
    } },
    provider: { transform: async (edit: (editor: { add: (item: Record<string, unknown>) => void }) => void) => {
      providerCount++;
      edit({ add: (item) => { registration = item; } });
      return { dispose: () => { disposed++; } };
    } },
  };
  const secret = 'b'.repeat(64);
  try {
    delete process.env.WEBBRIDGE_G81_TEST_ONLY;
    await plugin.setup(context);
    assert.equal(rpcCount, 0);
    process.env.WEBBRIDGE_G81_TEST_ONLY = '1';
    process.env.WEBBRIDGE_FIXTURE_ENABLE = '1';
    process.env.WEBBRIDGE_G81_SECRET = secret;
    process.env.WEBBRIDGE_FIXTURE_TOKEN = 'c'.repeat(64);
    process.env.WEBBRIDGE_FIXTURE_URL = 'https://example.com/v1';
    await assert.rejects(plugin.setup(context), /127\.0\.0\.1/);
    assert.equal(rpcCount, 0);
    process.env.WEBBRIDGE_FIXTURE_URL = 'http://127.0.0.1:23112/v1';
    const cleanup = await plugin.setup(context);
    assert.equal(rpcCount, 2);
    assert.equal(providerCount, 1);
    assert.deepEqual((registration.models as { id: string }[]).map((model) => model.id),
      ['webbridge-native-fixture']);
    const info = registration.info as { settings: { baseURL: string; apiKey: string } };
    assert.equal(info.settings.baseURL, 'http://127.0.0.1:23112/v1');
    assert.equal(info.settings.apiKey, 'c'.repeat(64));
    const valid = { secret, scope: 'g81-local-profile', nonce: 'g97_nonce_123' };
    await assert.rejects(handler({ ...valid, secret: '0'.repeat(64) }), /denied/);
    await assert.rejects(handler({ ...valid, scope: 'external' }), /denied/);
    assert.deepEqual(await handler(valid),
      { receipt: createHmac('sha256', secret).update(valid.nonce).digest('hex') });
    await assert.rejects(handler(valid), /replay denied/);
    await cleanup?.();
    assert.equal(disposed, 3);
    const source = await readFile(resolve('fixtures/g97-combined-preview.mjs'), 'utf8');
    assert.doesNotMatch(source, /from ['"](@opencode|\.\/|\.\.\/)/);
    assert.doesNotMatch(source, /https?:\/\/(?!127\.0\.0\.1)/);
  } finally {
    for (const [key, value] of initial) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
