import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../src/testing/native-rpc-relay-plugin.js';

test('native plugin RPC cancel preserves the pre-lease versus uncertain-lease boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-rpc-cancel-'));
  const before = ['WEBBRIDGE_RELAY_ENABLE', 'WEBBRIDGE_RELAY_TOKEN', 'WEBBRIDGE_RELAY_JOURNAL_DIR',
    'WEBBRIDGE_RELAY_WITNESS_DIR']
    .map((name) => [name, process.env[name]] as const);
  const token = randomBytes(32).toString('hex');
  process.env.WEBBRIDGE_RELAY_ENABLE = '1';
  process.env.WEBBRIDGE_RELAY_TOKEN = token;
  process.env.WEBBRIDGE_RELAY_JOURNAL_DIR = dir;
  delete process.env.WEBBRIDGE_RELAY_WITNESS_DIR;
  let handlers: Record<string, (request: unknown) => Promise<unknown>> = {};
  let disposed = false;
  try {
    const context = { rpc: { async register(_contract: unknown, impl: unknown) {
      handlers = impl as typeof handlers;
      return { async dispose() { disposed = true; } };
    } } };
    const cleanup = await fixture.setup(context as unknown as Parameters<typeof fixture.setup>[0]);
    try {
      const identity = { secret: token, sessionID: 'fixture-session', tabID: 'fixture-tab',
        providerID: 'qwen', accountRef: 'fixture-account' };
      assert.deepEqual(await handlers.submit({ ...identity, turnID: 'queued', prompt: 'local' }), { accepted: true });
      assert.deepEqual(await handlers.cancel({ ...identity, turnID: 'queued' }), { cancelled: true });
      assert.deepEqual(await handlers.take(identity), { found: false });
      assert.deepEqual(await handlers.submit({ ...identity, turnID: 'leased', prompt: 'local' }), { accepted: true });
      assert.deepEqual(await handlers.take(identity), { found: true, turnID: 'leased', prompt: 'local' });
      assert.deepEqual(await handlers.cancel({ ...identity, turnID: 'leased' }), { cancelled: false });
      await assert.rejects(handlers.cancel({ ...identity, secret: randomBytes(32).toString('hex'),
        turnID: 'leased' }), /unauthorized/);
    } finally {
      if (typeof cleanup === 'function') await cleanup();
    }
    assert.equal(disposed, true);
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
