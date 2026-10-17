import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableReadCheckpoint } from '../src/core/durable-read-checkpoint.js';
import { observeCheckpointedRead } from '../src/core/checkpointed-read-observer.js';
import type { BrowserPort, TabClaim, TurnEvent } from '../src/core/browser-port.js';
import type { RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';

const claim: TabClaim = { sessionID: 'sess1', providerID: 'qwen', tabID: 'tab1', accountRef: 'acct1' };
const identity: RecoveryIdentity = { ...claim, tabGeneration: 'tabgen1', connectionID: 'conn1',
  connectionGeneration: 'conngen1' };
const secret = randomBytes(32).toString('hex');

function sandbox(run: (dir: string, witness: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-read-observer-'));
  return run(join(root, 'store'), join(root, 'witness'))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}
function port(events: (after: number) => Promise<readonly TurnEvent[]>): Pick<BrowserPort, 'events'> & { submit: () => never } {
  return { events: async (_claim, _turn, after) => events(after),
    submit: () => { throw new Error('read observer MUST NEVER submit a browser effect'); } };
}

test('actual browser-port event read is persisted before caller observes each acknowledged frame', async () => sandbox(async (dir, witness) => {
  const store = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  let auth = 0;
  const delivered: string[] = [];
  const observed: TurnEvent[] = [];
  try {
    const browser = port(async (after) => after === 0
      ? [{ seq: 1, kind: 'text', turnID: 'turn1', value: 'hel' },
        { seq: 2, kind: 'text', turnID: 'turn1', value: 'lo' }]
      : [{ seq: 3, kind: 'finished', turnID: 'turn1' }]);
    for await (const item of observeCheckpointedRead({ browser, claim, identity, checkpoint: store,
      now: 1100, maxAgeMs: 60_000, authorizeRead: async () => { auth++; },
      acknowledge: async (item) => { delivered.push(`${item.seq}:${item.kind}`); } })) observed.push(item);
    assert.deepEqual(observed.map((x) => x.kind), ['text', 'text', 'finished']);
    assert.deepEqual(delivered, ['1:text', '2:text', '3:finished']);
    assert.equal(store.plan(identity, 1200, 60_000).action, 'terminal');
    assert.ok(auth >= 6);
  } finally { store.close(); }
  const restarted = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try { assert.equal(restarted.plan(identity, 1200, 60_000).action, 'terminal'); }
  finally { restarted.close(); }
}));

test('native permission revoked while browser read awaits rejects without delivering untrusted text', async () => sandbox(async (dir, witness) => {
  const store = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  let approvals = 0, receives = 0;
  try {
    const browser = port(async () => [{ seq: 1, kind: 'text', turnID: 'turn1', value: 'secret' }]);
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({ browser, claim, identity, checkpoint: store,
        now: 1100, maxAgeMs: 60_000, authorizeRead: async () => {
          if (++approvals > 1) throw new Error('native revoked');
        }, acknowledge: async () => { receives++; } })) { /* none */ }
    }, /native revoked/);
    assert.equal(receives, 0);
    const recovered = store.plan(identity, 1200, 60_000);
    assert.equal(recovered.action, 'resume-stream');
    if (recovered.action === 'resume-stream') assert.equal(recovered.fromFragmentIndex, 0);
  } finally { store.close(); }
}));

test('sink uncertainty fails closed, and malformed cross-turn frame never reaches the sink', async () => sandbox(async (dir, witness) => {
  const store = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  let ack = 0;
  try {
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({ browser: port(async () =>
        [{ seq: 1, kind: 'text', turnID: 'other', value: 'wrong' }]), claim, identity,
        checkpoint: store, now: 1100, maxAgeMs: 60_000, authorizeRead: async () => {},
        acknowledge: async () => { ack++; } })) { /* none */ }
    }, /identity|frame/);
    assert.equal(ack, 0);
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({ browser: port(async () =>
        [{ seq: 1, kind: 'text', turnID: 'turn1', value: 'hello' }]), claim, identity,
        checkpoint: store, now: 1100, maxAgeMs: 60_000, authorizeRead: async () => {},
        acknowledge: async () => { ack++; throw new Error('ack lost after sink'); } })) { /* none */ }
    }, /uncertain|ack lost/);
    assert.equal(store.plan(identity, 1200, 60_000).action, 'terminal');
    assert.deepEqual(store.admit(0), { admit: false, reason: 'abandoned' });
  } finally { store.close(); }
}));

test('missing native read authority and mismatched tab scope never invoke browser events', async () => sandbox(async (dir, witness) => {
  const store = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  let calls = 0;
  try {
    const browser = port(async () => { calls++; return []; });
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({ browser, claim, identity, checkpoint: store,
        now: 1100, maxAgeMs: 60_000, acknowledge: async () => {} })) { /* none */ }
    }, /native read authority/);
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({ browser, claim: { ...claim, tabID: 'other' },
        identity, checkpoint: store, now: 1100, maxAgeMs: 60_000,
        authorizeRead: async () => {}, acknowledge: async () => {} })) { /* none */ }
    }, /scope/);
    assert.equal(calls, 0);
  } finally { store.close(); }
}));

test('revocation during sink ACK tombstones uncertain read instead of yielding or replaying', async () => sandbox(async (dir, witness) => {
  const store = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  let live = true, observed = 0;
  try {
    await assert.rejects(async () => {
      for await (const _ of observeCheckpointedRead({
        browser: port(async () => [{ seq: 1, kind: 'text', turnID: 'turn1', value: 'pending' }]),
        claim, identity, checkpoint: store, now: 1100, maxAgeMs: 60_000,
        authorizeRead: async () => { if (!live) throw new Error('native revoked'); },
        acknowledge: async () => { live = false; },
      })) observed++;
    }, /uncertain|revoked/);
    assert.equal(observed, 0);
    assert.equal(store.plan(identity, 1200, 60_000).action, 'terminal');
  } finally { store.close(); }
}));
