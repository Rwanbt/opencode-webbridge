import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableReadCheckpoint } from '../src/core/durable-read-checkpoint.js';
import type { RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';

const identity: RecoveryIdentity = {
  sessionID: 'session1', providerID: 'qwen', accountRef: 'account1', tabID: 'tab1',
  tabGeneration: 'tabgen1', connectionID: 'conn1', connectionGeneration: 'conngen1',
};
const secret = randomBytes(32).toString('hex');

function sandbox(run: (dir: string, witness: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-read-checkpoint-'));
  try { run(join(root, 'journal'), join(root, 'witness')); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('actual fsynced checkpoint resumes from exactly the next fragment after restart', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  assert.deepEqual(first.admit(0), { admit: true });
  assert.deepEqual(first.admit(1), { admit: true });
  assert.deepEqual(first.admit(1), { admit: false, reason: 'duplicate' });
  first.close();
  const second = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try {
    const recovery = second.plan(identity, 1100, 60_000);
    assert.equal(recovery.action, 'resume-stream');
    if (recovery.action === 'resume-stream') assert.equal(recovery.fromFragmentIndex, 2);
    assert.deepEqual(second.admit(3), { admit: false, reason: 'gap' });
    assert.deepEqual(second.admit(2), { admit: true });
  } finally { second.close(); }
}));

test('connection, tab, account, identity and lock confusion all fail closed', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /locked/);
  first.close();
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, { ...identity, accountRef: 'other' }, 'turn1', secret, 1000), /identity/);
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn2', secret, 1000), /turn/);
  const restored = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try {
    const plan = restored.plan({ ...identity, tabGeneration: 'newgen' }, 1100, 60_000);
    assert.equal(plan.action, 'reject');
    assert.deepEqual(restored.admit(1), { admit: false, reason: 'gap' });
  } finally { restored.close(); }
}));

test('abandoned checkpoint is a durable tombstone, cannot emit or resume after restart', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  first.admit(0);
  first.abort();
  first.close();
  const restored = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try {
    assert.deepEqual(restored.admit(1), { admit: false, reason: 'abandoned' });
    const plan = restored.plan(identity, 1100, 60_000);
    assert.equal(plan.action, 'terminal');
    if (plan.action === 'terminal') assert.equal(plan.outcome, 'aborted');
  } finally { restored.close(); }
}));

test('restoring older HMAC-valid checkpoint or removing its witness refuses rollback', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  first.admit(0);
  const older = readFileSync(join(dir, 'checkpoint.json'));
  first.admit(1);
  first.close();
  writeFileSync(join(dir, 'checkpoint.json'), older);
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /rollback|witness/);
  // A missing witness is never interpreted as an empty checkpoint.
  unlinkSync(join(witness, 'witness.json'));
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /missing|witness/);
}));

test('missing both files cannot silently bootstrap as if no previous turn existed', () => sandbox((dir, witness) => {
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /missing|initialize/);
  const initial = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  initial.admit(0);
  initial.close();
  unlinkSync(join(dir, 'checkpoint.json'));
  unlinkSync(join(witness, 'witness.json'));
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /missing|initialize/);
}));

test('complete read is a terminal durable marker and cannot be reopened as new read', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  first.admit(0);
  first.finish();
  first.close();
  assert.throws(() => DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000), /already initialized/);
  const restored = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try {
    const result = restored.plan(identity, 1100, 60_000);
    assert.equal(result.action, 'terminal');
    assert.deepEqual(restored.admit(1), { admit: false, reason: 'abandoned' });
    assert.throws(() => restored.finish(), /terminal/);
  } finally { restored.close(); }
}));

test('tampered checkpoint, wrong key, stale connection and nested witness all refuse', () => sandbox((dir, witness) => {
  const first = DurableReadCheckpoint.initialize(dir, witness, identity, 'turn1', secret, 1000);
  first.admit(0);
  first.close();
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', '0'.repeat(64), 1000), /identity|integrity/);
  const restored = DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000);
  try {
    assert.equal(restored.plan(identity, 99_000, 500).action, 'reject');
    assert.equal(restored.plan({ ...identity, connectionGeneration: 'newgen' }, 1100, 60_000).action, 'reject');
  } finally { restored.close(); }
  const file = join(dir, 'checkpoint.json');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('"lastConfirmedFragment":0', '"lastConfirmedFragment":9'));
  assert.throws(() => DurableReadCheckpoint.open(dir, witness, identity, 'turn1', secret, 1000), /integrity|rollback/);
  assert.throws(() => DurableReadCheckpoint.initialize(dir, join(dir, 'witness-nested'), identity,
    'turn2', secret, 1000), /independent/);
}));
