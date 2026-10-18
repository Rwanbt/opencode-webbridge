import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { BrowserHostCapability } from '../src/core/browser-host-capability.js';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { TabClaim } from '../src/core/browser-port.js';

const owner: TabClaim = { sessionID: 'ses_host', providerID: 'qwen', tabID: 'tab_host', accountRef: 'account_local' };
const permission = { assert: async () => {} };
const secret = randomBytes(32).toString('hex');
async function isolated(fn: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-host-receipt-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function host(journal: DurableRelayJournal) {
  // Cast needed on baseline to reproduce the missing wiring at runtime.
  const broker = new (BrowserHostCapability as any)(permission, journal) as BrowserHostCapability;
  const unregister = broker.register({ binding: owner, port: new FakeBrowserPort(), consented: async () => true });
  return { broker, unregister };
}

test('after crash before terminal observation, a new host cannot replay uncertain send', async () => {
  await isolated(async (dir) => {
    const j1 = DurableRelayJournal.open(dir, owner, secret);
    const first = host(j1);
    await first.broker.claim(owner);
    await first.broker.submit(owner, { turnID: 'in-flight', prompt: 'private prompt' });
    assert.deepEqual(j1.status(), [{ turnID: 'in-flight', phase: 'leased' }]);
    await first.broker.release(owner);
    first.unregister();
    j1.close();
    const j2 = DurableRelayJournal.open(dir, owner, secret);
    try {
      const second = host(j2);
      await second.broker.claim(owner);
      await assert.rejects(second.broker.submit(owner, { turnID: 'in-flight', prompt: 'replay' }), /recorded|reconcile/);
      await assert.rejects(second.broker.submit(owner, { turnID: 'next', prompt: 'unsafe' }), /unresolved/);
      await second.broker.release(owner);
      second.unregister();
    } finally { j2.close(); }
  });
});

test('only a valid terminal event durably settles a turn; old ID never replays', async () => {
  await isolated(async (dir) => {
    const j1 = DurableRelayJournal.open(dir, owner, secret);
    const first = host(j1);
    await first.broker.claim(owner);
    await first.broker.submit(owner, { turnID: 'confirmed-1', prompt: 'hello' });
    assert.equal(j1.status()[0]?.phase, 'leased');
    assert.deepEqual((await first.broker.events(owner, 'confirmed-1', 0)).map((e) => e.kind), ['text', 'finished']);
    assert.equal(j1.status()[0]?.phase, 'settled');
    await first.broker.release(owner);
    first.unregister();
    j1.close();
    const j2 = DurableRelayJournal.open(dir, owner, secret);
    try {
      const second = host(j2);
      await second.broker.claim(owner);
      await assert.rejects(second.broker.submit(owner, { turnID: 'confirmed-1', prompt: 'replay' }), /recorded/);
      await second.broker.submit(owner, { turnID: 'confirmed-2', prompt: 'fresh' });
      assert.equal(j2.status()[1]?.phase, 'leased');
      await second.broker.release(owner);
      second.unregister();
    } finally { j2.close(); }
  });
});

test('foreign account cannot register on a journal owned by a different account', async () => {
  await isolated(async (dir) => {
    const journal = DurableRelayJournal.open(dir, owner, secret);
    try {
      const gate = new (BrowserHostCapability as any)(permission, journal) as BrowserHostCapability;
      assert.throws(() => gate.register({ binding: { ...owner, accountRef: 'other' },
        port: new FakeBrowserPort(), consented: async () => true }), /binding mismatch/);
      assert.deepEqual(journal.status(), []);
    } finally { journal.close(); }
  });
});

test('forged terminal belonging to a different turn cannot settle a durable receipt', async () => {
  await isolated(async (dir) => {
    const journal = DurableRelayJournal.open(dir, owner, secret);
    try {
      const broker = new BrowserHostCapability(permission, journal);
      const unregister = broker.register({ binding: owner, consented: async () => true, port: {
        claim: async () => {}, submit: async () => {}, cancel: async () => false,
        release: async () => {},
        events: async () => [{ seq: 1, kind: 'finished' as const, turnID: 'other-turn' }],
      } });
      await broker.claim(owner);
      await broker.submit(owner, { turnID: 'real-turn', prompt: 'private page input' });
      await assert.rejects(broker.events(owner, 'real-turn', 0), /invalid|identity|terminal/);
      assert.deepEqual(journal.status(), [{ turnID: 'real-turn', phase: 'leased' }]);
      await broker.release(owner);
      unregister();
    } finally { journal.close(); }
  });
});
