import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import { RpcRelayPort } from '../src/core/rpc-relay-port.js';
import type { TabClaim } from '../src/core/browser-port.js';

const owner: TabClaim = { sessionID: 's1', providerID: 'qwen', tabID: 't1', accountRef: 'a1' };
const key = randomBytes(32).toString('hex');
const evidenceHash = createHash('sha256').update('verified outside the program').digest('hex');

test('uncertain lease requires explicit operator evidence, stays deduplicated after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-g7-test-'));
  try {
    const first = DurableRelayJournal.open(dir, owner, key);
    const relay = new RpcRelayPort(key, first);
    await relay.claim(owner);
    await relay.submit(owner, { turnID: 'turn1', prompt: 'must never persist' });
    assert.equal(relay.take(key, owner)?.turnID, 'turn1');
    first.close();
    const second = DurableRelayJournal.open(dir, owner, key);
    try {
      assert.throws(() => second.reconcile('turn1', {
        outcome: 'observed-applied', evidenceHash: 'invalid', operatorID: 'operator-1',
        acknowledged: true,
      }), /evidence/i);
      assert.throws(() => second.reconcile('turn1', {
        outcome: 'observed-applied', evidenceHash, operatorID: 'operator-1',
        acknowledged: false,
      }), /acknowledg/i);
      second.reconcile('turn1', { outcome: 'observed-applied', evidenceHash,
        operatorID: 'operator-1', acknowledged: true });
      assert.deepEqual(second.status(), [{ turnID: 'turn1', phase: 'reconciled' }]);
      assert.throws(() => second.reconcile('turn1', {
        outcome: 'observed-not-applied', evidenceHash, operatorID: 'operator-2', acknowledged: true,
      }), /already|reconciled|uncertain/i);
      const json = readFileSync(join(dir, 'journal.json'), 'utf8');
      assert.doesNotMatch(json, /must never persist|operator-1|verified outside the program|"secret"/);
      assert.match(json, /observed-applied/);
    } finally { second.close(); }
    const third = DurableRelayJournal.open(dir, owner, key);
    try {
      const reopened = new RpcRelayPort(key, third);
      await reopened.claim(owner);
      await assert.rejects(reopened.submit(owner, { turnID: 'turn1', prompt: 'retry' }), /already recorded/);
      await reopened.submit(owner, { turnID: 'turn2', prompt: 'new job' });
      assert.equal(reopened.take(key, owner)?.turnID, 'turn2');
    } finally { third.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reconciliation cannot close settled, cancelled, missing or forged journal entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-g7-negative-'));
  try {
    const journal = DurableRelayJournal.open(dir, owner, key);
    try {
      const args = { outcome: 'observed-not-applied' as const, evidenceHash, operatorID: 'a', acknowledged: true };
      assert.throws(() => journal.reconcile('missing', args), /uncertain/);
      journal.prepare('cancelled'); journal.cancelled('cancelled');
      assert.throws(() => journal.reconcile('cancelled', args), /uncertain/);
      journal.prepare('done'); journal.leased('done'); journal.settled('done');
      assert.throws(() => journal.reconcile('done', args), /uncertain/);
      journal.prepare('uncertain');
      assert.throws(() => journal.reconcile('uncertain', { ...args, operatorID: 'not valid spaces' }), /operator/i);
      assert.deepEqual(journal.status().at(-1), { turnID: 'uncertain', phase: 'prepared' });
    } finally { journal.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('operator CLI is read-only by default, requires explicit attestation, and never removes locks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-g7-cli-'));
  const script = resolve('scripts/reconcile-relay.mjs');
  const flags = ['--dir', dir, '--session', 's1', '--provider', 'qwen', '--tab', 't1', '--account', 'a1'];
  const env = { ...process.env, WEBBRIDGE_RELAY_TOKEN: key };
  const invoke = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  try {
    const initial = DurableRelayJournal.open(dir, owner, key);
    initial.prepare('turn1'); initial.close();
    const inspect = invoke('inspect', ...flags);
    assert.equal(inspect.status, 0, inspect.stderr);
    assert.match(inspect.stdout, /"phase":\s*"prepared"/);
    const noAck = invoke('resolve', ...flags, '--turn', 'turn1', '--outcome', 'observed-not-applied',
      '--evidence-sha256', evidenceHash, '--operator', 'op1');
    assert.notEqual(noAck.status, 0);
    const lock = DurableRelayJournal.open(dir, owner, key);
    const whileOwned = invoke('inspect', ...flags);
    assert.notEqual(whileOwned.status, 0);
    assert.match(whileOwned.stderr, /locked/);
    lock.close();
    const resolved = invoke('resolve', ...flags, '--turn', 'turn1', '--outcome', 'observed-not-applied',
      '--evidence-sha256', evidenceHash, '--operator', 'op1', '--ack', 'I-VERIFIED-REMOTE-OUTCOME');
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.doesNotMatch(resolved.stdout + resolved.stderr, new RegExp(key));
    const after = invoke('inspect', ...flags);
    assert.match(after.stdout, /reconciled/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reconciliation evidence cannot be altered on disk without invalidating HMAC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-g7-integrity-'));
  try {
    const journal = DurableRelayJournal.open(dir, owner, key);
    journal.prepare('turn1');
    journal.reconcile('turn1', { outcome: 'observed-not-applied', evidenceHash,
      operatorID: 'reviewer', acknowledged: true });
    journal.close();
    const path = join(dir, 'journal.json');
    const tampered = JSON.parse(readFileSync(path, 'utf8'));
    tampered.entries[0].attestation.outcome = 'observed-applied';
    writeFileSync(path, JSON.stringify(tampered));
    assert.throws(() => DurableRelayJournal.open(dir, owner, key), /integrity mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
