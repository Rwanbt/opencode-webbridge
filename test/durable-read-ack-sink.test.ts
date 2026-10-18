import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableReadAckSink } from '../src/core/durable-read-ack-sink.js';
import { DurableReadCheckpoint } from '../src/core/durable-read-checkpoint.js';
import { observeCheckpointedRead } from '../src/core/checkpointed-read-observer.js';
import type { RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';
import type { TurnEvent } from '../src/core/browser-port.js';

const identity: RecoveryIdentity = { sessionID: 'sess1', providerID: 'qwen',
  accountRef: 'opaqueAccount', tabID: 'tab1', tabGeneration: 'tabGen1',
  connectionID: 'connection1', connectionGeneration: 'generation1' };
const secret = randomBytes(32).toString('hex');
const first: TurnEvent = { kind: 'text', turnID: 'turn1', seq: 1, value: 'secret browser answer' };
const done: TurnEvent = { kind: 'finished', turnID: 'turn1', seq: 2 };
const sandbox = async (run: (root: string, store: string, witness: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-read-ack-'));
  try { await run(root, join(root, 'ack'), join(root, 'witness')); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

test('real fsync + encrypted receipt + restart + identical duplicate no new effect', async () =>
  sandbox(async (_root, dir, witness) => {
    let sink = DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret);
    await sink.acknowledge(first);
    assert.deepEqual(sink.readAll(), [first]);
    assert.ok(!readFileSync(join(dir, 'read-ack.enc.json'), 'utf8').includes(first.value));
    await sink.acknowledge(done);
    sink.close();
    sink = DurableReadAckSink.open(dir, witness, identity, 'turn1', secret);
    try {
      const original = readFileSync(join(dir, 'read-ack.enc.json'), 'utf8');
      await sink.acknowledge(first); // lost ACK, retried only to this sink: does not duplicate
      await sink.acknowledge(done);
      assert.equal(readFileSync(join(dir, 'read-ack.enc.json'), 'utf8'), original);
      const values = sink.readAll() as TurnEvent[];
      assert.deepEqual(values, [first, done]);
      assert.throws(() => { (values[0] as { value: string }).value = 'caller tamper'; }, TypeError);
      assert.deepEqual(sink.readAll(), [first, done]);
    } finally { sink.close(); }
  }));

test('rejects cross-turn, forged identity, gaps, conflicting replay and post-terminal text', async () =>
  sandbox(async (_root, dir, witness) => {
    let sink = DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret);
    try {
      await assert.rejects(sink.acknowledge({ ...first, seq: 2 }), /gap/);
      await assert.rejects(sink.acknowledge({ ...first, turnID: 'turnOther' }), /wrong turn/);
      await sink.acknowledge(first);
      await assert.rejects(sink.acknowledge({ ...first, value: 'conflict' }), /conflict/);
      await sink.acknowledge(done);
      await assert.rejects(sink.acknowledge({ ...first, seq: 3 }), /terminal/);
    } finally { sink.close(); }
    assert.throws(() => DurableReadAckSink.open(dir, witness,
      { ...identity, tabGeneration: 'forged' }, 'turn1', secret), /integrity|rollback/);
    assert.throws(() => DurableReadAckSink.open(dir, witness, identity, 'turn1',
      randomBytes(32).toString('hex')), /integrity|rollback/);
    assert.throws(() => DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret),
      /already exists/);
  }));

test('rejects forged witness, rollback, missing history and concurrent opener', async () =>
  sandbox(async (_root, dir, witness) => {
    const sink = DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret);
    assert.throws(() => DurableReadAckSink.open(dir, witness, identity, 'turn1', secret), /locked/);
    const old = readFileSync(join(dir, 'read-ack.enc.json'), 'utf8');
    await sink.acknowledge(first);
    sink.close();
    writeFileSync(join(dir, 'read-ack.enc.json'), old);
    assert.throws(() => DurableReadAckSink.open(dir, witness, identity, 'turn1', secret),
      /integrity|rollback/);
    rmSync(dir, { recursive: true, force: true });
    rmSync(witness, { recursive: true, force: true });
    assert.throws(() => DurableReadAckSink.open(dir, witness, identity, 'turn1', secret),
      /directory invalid|missing/);
  }));

test('rejects accessor inputs without executing frame value getter', async () =>
  sandbox(async (_root, dir, witness) => {
    const sink = DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret);
    try {
      let invoked = 0;
      const malicious = { kind: 'text', turnID: 'turn1', seq: 1,
        get value() { invoked++; return 'hostile'; } };
      await assert.rejects(sink.acknowledge(malicious as TurnEvent), /getter/);
      const maliciousKind = Object.defineProperty({ turnID: 'turn1', seq: 1 },
        'kind', { enumerable: true, get() { invoked++; return 'text'; } });
      await assert.rejects(sink.acknowledge(maliciousKind as TurnEvent), /getter/);
      assert.equal(invoked, 0);
      assert.deepEqual(sink.readAll(), []);
    } finally { sink.close(); }
  }));

test('read-only BrowserPort -> native-authorized observer seam -> encrypted durable sink -> checkpoint', async () =>
  sandbox(async (root, dir, witness) => {
    const sink = DurableReadAckSink.initialize(dir, witness, identity, 'turn1', secret);
    const checkpoint = DurableReadCheckpoint.initialize(join(root, 'cursor'),
      join(root, 'cursor-witness'), identity, 'turn1', secret, 1000);
    const observed: TurnEvent[] = [];
    let portReads = 0;
    try {
      for await (const event of observeCheckpointedRead({
        browser: { events: async (_claim, _turn, afterSeq) => {
          portReads++;
          return afterSeq === 0 ? [first] : [done];
        } },
        claim: { sessionID: 'sess1', providerID: 'qwen', accountRef: 'opaqueAccount', tabID: 'tab1' },
        identity, checkpoint, now: 1100, maxAgeMs: 3000,
        authorizeRead: async () => {}, // OFFLINE fixture only: not real Core authority.
        acknowledge: (event) => sink.acknowledge(event),
      })) observed.push(event);
      assert.equal(portReads, 2);
      assert.deepEqual(observed, [first, done]);
      assert.deepEqual(sink.readAll(), [first, done]);
      assert.equal(checkpoint.plan(identity, 1200, 3000).action, 'terminal');
    } finally { checkpoint.close(); sink.close(); }
    const restored = DurableReadAckSink.open(dir, witness, identity, 'turn1', secret);
    try { assert.deepEqual(restored.readAll(), [first, done]); }
    finally { restored.close(); }
  }));
