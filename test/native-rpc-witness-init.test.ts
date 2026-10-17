import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../src/testing/native-rpc-relay-plugin.js';

test('fixture RPC refuses to register without independent witnessed history', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'webbridge-native-witness-'));
  const names = ['WEBBRIDGE_RELAY_ENABLE', 'WEBBRIDGE_RELAY_TOKEN',
    'WEBBRIDGE_RELAY_JOURNAL_DIR', 'WEBBRIDGE_RELAY_WITNESS_DIR'] as const;
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  let registrations = 0;
  try {
    process.env.WEBBRIDGE_RELAY_ENABLE = '1';
    process.env.WEBBRIDGE_RELAY_TOKEN = randomBytes(32).toString('hex');
    process.env.WEBBRIDGE_RELAY_JOURNAL_DIR = join(tmp, 'journal');
    delete process.env.WEBBRIDGE_RELAY_WITNESS_DIR;
    const context = { rpc: { register: async () => { registrations++; return { dispose: async () => {} }; } } };
    await assert.rejects(async () => { await plugin.setup(context as never); }, /independent witness directory/);
    assert.equal(registrations, 0);
    // Even when a caller tries to point the witness at the journal itself,
    // startup must fail before registering externally reachable RPC routes.
    process.env.WEBBRIDGE_RELAY_WITNESS_DIR = process.env.WEBBRIDGE_RELAY_JOURNAL_DIR;
    await assert.rejects(async () => { await plugin.setup(context as never); }, /independent witness must be outside/);
    assert.equal(registrations, 0);
  } finally {
    for (const name of names) {
      const old = saved[name];
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    }
    rmSync(tmp, { force: true, recursive: true });
  }
});
