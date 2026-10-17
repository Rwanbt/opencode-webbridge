import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixture from '../src/testing/native-rpc-relay-plugin.js';

test('native RPC fixture persists witness and refuses same-turn replay and witness downgrade', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-g20-native-witness-'));
  const names = ['WEBBRIDGE_RELAY_ENABLE', 'WEBBRIDGE_RELAY_TOKEN',
    'WEBBRIDGE_RELAY_JOURNAL_DIR', 'WEBBRIDGE_RELAY_WITNESS_DIR'] as const;
  const before = names.map((name) => [name, process.env[name]] as const);
  const token = randomBytes(32).toString('hex');
  process.env.WEBBRIDGE_RELAY_ENABLE = '1';
  process.env.WEBBRIDGE_RELAY_TOKEN = token;
  process.env.WEBBRIDGE_RELAY_JOURNAL_DIR = join(root, 'journal');
  process.env.WEBBRIDGE_RELAY_WITNESS_DIR = join(root, 'witness');
  let handlers: Record<string, (raw: unknown) => Promise<unknown>> = {};
  let registrations = 0;
  const ctx = { rpc: { async register(_contract: unknown, impl: unknown) {
    registrations++;
    handlers = impl as typeof handlers;
    return { async dispose() {} };
  } } } as unknown as Parameters<typeof fixture.setup>[0];
  const identity = { secret: token, sessionID: 'fixture-session', tabID: 'fixture-tab',
    providerID: 'qwen', accountRef: 'fixture-account' };
  try {
    const first = await fixture.setup(ctx);
    assert.deepEqual(await handlers.submit({ ...identity, turnID: 'turn-1', prompt: 'private' }), { accepted: true });
    assert.deepEqual(await handlers.cancel({ ...identity, turnID: 'turn-1' }), { cancelled: true });
    if (typeof first === 'function') await first();
    const stored = JSON.parse(readFileSync(join(root, 'journal', 'journal.json'), 'utf8'));
    assert.equal(stored.version, 2);
    assert.equal(stored.witnessRequired, true);
    assert.doesNotMatch(JSON.stringify(stored), /private|fixture-account/);

    const second = await fixture.setup(ctx);
    try {
      await assert.rejects(handlers.submit({ ...identity, turnID: 'turn-1', prompt: 'private' }), /already recorded/);
    } finally { if (typeof second === 'function') await second(); }

    delete process.env.WEBBRIDGE_RELAY_WITNESS_DIR;
    await assert.rejects(async () => { await fixture.setup(ctx); }, /witness mode mismatch/);
    assert.equal(registrations, 2, 'downgrade must fail before registering an RPC effect surface');
  } finally {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
