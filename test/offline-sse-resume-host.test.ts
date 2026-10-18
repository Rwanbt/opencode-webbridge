import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfflineSseResumeHost } from '../src/testing/offline-sse-resume-host.js';
import { DurableReadAckSink } from '../src/core/durable-read-ack-sink.js';
import { DurableReadCheckpoint } from '../src/core/durable-read-checkpoint.js';
import type { RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';
import type { TurnEvent } from '../src/core/browser-port.js';

const identity: RecoveryIdentity = {
  sessionID: 'sess_1', providerID: 'qwen', accountRef: 'fixtureAccount',
  tabID: 'tab_1', tabGeneration: 'tab_gen_1',
  connectionID: 'conn_1', connectionGeneration: 'conn_gen_1',
};
const first: TurnEvent = { kind: 'text', seq: 1, turnID: 'turn_1', value: 'PRIVATE_SSE_TEXT' };
const second: TurnEvent = { kind: 'text', seq: 2, turnID: 'turn_1', value: 'second\nline' };
const finished: TurnEvent = { kind: 'finished', seq: 3, turnID: 'turn_1' };
const key = randomBytes(32).toString('hex');
const sandbox = async (run: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'g148-sse-'));
  try { await run(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('G148 dropped host ACK and dead SSE listener recover only persisted data', async () =>
  sandbox(async (root) => {
    let host = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    const beginning = host.startCursor();
    assert.equal((await host.acknowledgeRead(first, identity, 1100)).status, 'committed');
    const encrypted = readFileSync(join(root, 'read', 'read-ack.enc.json'), 'utf8');
    const witness = readFileSync(join(root, 'read-witness', 'read-ack.witness.json'), 'utf8');
    assert.ok(!encrypted.includes(first.value));
    host.close(); // Listener disappears after durable receipt, BEFORE seeing SSE or host ACK.
    host = OfflineSseResumeHost.open(root, identity, 'turn_1', key, 1200);
    try {
      assert.equal((await host.acknowledgeRead(first, identity, 1250)).status, 'duplicate');
      assert.equal(readFileSync(join(root, 'read', 'read-ack.enc.json'), 'utf8'), encrypted);
      assert.equal(readFileSync(join(root, 'read-witness', 'read-ack.witness.json'), 'utf8'), witness);
      await host.acknowledgeRead(second, identity, 1300);
      await host.acknowledgeRead(finished, identity, 1400);
      const all = host.replay(beginning, identity, 1500);
      assert.deepEqual(all.map((entry) => entry.event.seq), [1, 2, 3]);
      assert.equal(all[0].wire, `id: ${all[0].cursor}\nevent: text\ndata: ${JSON.stringify(first)}\n\n`);
      assert.ok(all[1].wire.includes('second\\nline')); // no line injection
      assert.deepEqual(host.replay(all[0].cursor, identity, 1501).map((e) => e.event.seq), [2, 3]);
      assert.deepEqual(host.replay(all[2].cursor, identity, 1502), []);
      assert.equal((await host.acknowledgeRead(finished, identity, 1503)).status, 'duplicate');
      await assert.rejects(host.acknowledgeRead({ ...second, seq: 4 }, identity, 1504), /terminal|gap/);
    } finally { host.close(); }
  }));

test('G148 no cross-account, cross-session, rotated generation or forged cursor replay', async () =>
  sandbox(async (root) => {
    const host = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    try {
      const start = host.startCursor();
      await host.acknowledgeRead(first, identity, 1100);
      for (const mutated of [
        { ...identity, accountRef: 'anotherAccount' },
        { ...identity, sessionID: 'anotherSession' },
        { ...identity, providerID: 'chatgpt' },
        { ...identity, tabID: 'otherTab' },
        { ...identity, tabGeneration: 'replacedTab' },
        { ...identity, connectionID: 'otherConnection' },
        { ...identity, connectionGeneration: 'rotatedGen' },
      ]) {
        assert.throws(() => host.replay(start, mutated, 1200), /denied|mismatch|scope/);
        await assert.rejects(host.acknowledgeRead(second, mutated, 1200), /denied|mismatch|scope/);
      }
      const valid = host.replay(start, identity, 1200)[0].cursor;
      for (const forged of [valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a'),
        valid.replace('v1.1.', 'v1.2.'), 'v1.01.' + 'f'.repeat(64), 'bad', undefined as never]) {
        assert.throws(() => host.replay(forged, identity, 1300), /cursor/);
      }
      let fired = 0;
      const hostile = { ...identity, get accountRef() { fired++; return identity.accountRef; } };
      assert.throws(() => host.replay(start, hostile, 1400), /getter|identity|scope/);
      assert.equal(fired, 0);
    } finally { host.close(); }
    assert.throws(() => OfflineSseResumeHost.open(root,
      { ...identity, connectionGeneration: 'rotatedGen' }, 'turn_1', key, 1500), /mismatch|integrity|rollback/);
  }));

test('G148 strict sequence, conflicting content, text and replay byte budgets', async () =>
  sandbox(async (root) => {
    const host = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    try {
      await assert.rejects(host.acknowledgeRead(second, identity, 1200), /gap/);
      await host.acknowledgeRead(first, identity, 1201);
      await assert.rejects(host.acknowledgeRead({ ...first, value: 'forged' }, identity, 1202), /conflict/);
      await assert.rejects(host.acknowledgeRead({ ...second, turnID: 'otherTurn' }, identity, 1202), /turn/);
      await assert.rejects(host.acknowledgeRead({ ...second, value: 'z'.repeat(4097) }, identity, 1202), /budget/);
      await host.acknowledgeRead(second, identity, 1203);
      const start = host.startCursor();
      assert.throws(() => host.replay(start, identity, 1204, 10), /byte budget/);
      assert.throws(() => host.replay(start, identity, 1204, 0), /budget/);
      assert.ok(host.replay(start, identity, 1204, 1024).length === 2);
      await host.acknowledgeRead(finished, identity, 1205);
      assert.throws(() => host.replay(start, identity, 1000 + 30_001), /stale|window/);
      await assert.rejects(host.acknowledgeRead(first, identity, 1000 + 30_001), /stale|window/);
    } finally { host.close(); }
  }));

test('G148 crash between encrypted ACK and checkpoint repairs durable data only', async () =>
  sandbox(async (root) => {
    const initial = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    const start = initial.startCursor();
    initial.close();
    const sink = DurableReadAckSink.open(join(root, 'read'), join(root, 'read-witness'),
      identity, 'turn_1', key);
    await sink.acknowledge(first); // Durable ACK written; simulated checkpoint process dies.
    sink.close();
    const resumed = OfflineSseResumeHost.open(root, identity, 'turn_1', key, 1400);
    try {
      assert.deepEqual(resumed.replay(start, identity, 1500).map((e) => e.event), [first]);
      assert.equal((await resumed.acknowledgeRead(first, identity, 1600)).status, 'duplicate');
    } finally { resumed.close(); }
  }));

test('G148 forged ciphertext/witness cannot become a replay source', async () =>
  sandbox(async (root) => {
    const host = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    await host.acknowledgeRead(first, identity, 1100);
    host.close();
    const path = join(root, 'read', 'read-ack.enc.json');
    const original = JSON.parse(readFileSync(path, 'utf8')) as { cipher: string };
    writeFileSync(path, JSON.stringify({ ...original, cipher: 'AAAA' }));
    assert.throws(() => OfflineSseResumeHost.open(root, identity, 'turn_1', key, 1200),
      /integrity|rollback|mismatch/);
  }));

test('G148 signed checkpoint ahead of durable receipt cannot skip lost data', async () =>
  sandbox(async (root) => {
    const host = OfflineSseResumeHost.initialize(root, identity, 'turn_1', key, 1000);
    host.close();
    const cursor = DurableReadCheckpoint.open(join(root, 'cursor'),
      join(root, 'cursor-witness'), identity, 'turn_1', key, 1100);
    assert.deepEqual(cursor.admit(0), { admit: true });
    cursor.close();
    assert.throws(() => OfflineSseResumeHost.open(root, identity, 'turn_1', key, 1200),
      /checkpoint ahead/);
  }));
