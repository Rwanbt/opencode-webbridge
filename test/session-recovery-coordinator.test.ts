import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { admitFragment, planRecovery } from '../src/core/session-recovery-coordinator.js';
import type { RecordedTurn, RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import type { TabClaim } from '../src/core/browser-port.js';

const identity: RecoveryIdentity = {
  sessionID: 'sess-r1', providerID: 'qwen', accountRef: 'acct-r1', tabID: 'tab-r1',
  tabGeneration: 'gen-tab-1', connectionID: 'conn-r1', connectionGeneration: 'gen-conn-1',
};
const incoming: RecoveryIdentity = { ...identity };
const NOW = 1_700_000_000_000;

function record(overrides: Partial<RecordedTurn> = {}): RecordedTurn {
  return {
    turnID: 'turn-r1', identity, recordedAt: NOW - 1_000,
    journalPhase: null, streamPhase: 'streaming', lastConfirmedFragment: 3,
    ...overrides,
  };
}

function plan(overrides: Partial<RecordedTurn> = {}, extra: Partial<{
  incoming: RecoveryIdentity | null; requestedTurnID: string; now: number; maxAgeMs: number;
}> = {}) {
  return planRecovery({
    record: record(overrides),
    incoming: extra.incoming === undefined ? incoming : extra.incoming,
    requestedTurnID: extra.requestedTurnID ?? 'turn-r1',
    now: extra.now ?? NOW,
    maxAgeMs: extra.maxAgeMs ?? 60_000,
  });
}

test('no recorded turn is a fresh start: nothing was attempted, retry cannot duplicate', () => {
  const result = planRecovery({
    record: null, incoming, requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'fresh-start');
});

test('verified mid-flight read resumes after the last confirmed fragment', () => {
  const result = plan({ lastConfirmedFragment: 3 });
  assert.equal(result.action, 'resume-stream');
  if (result.action === 'resume-stream') {
    assert.equal(result.fromFragmentIndex, 4);
    assert.equal(result.turnID, 'turn-r1');
  }
});

test('a read with no confirmed fragment yet resumes from the first fragment', () => {
  const result = plan({ lastConfirmedFragment: -1 });
  assert.equal(result.action, 'resume-stream');
  if (result.action === 'resume-stream') assert.equal(result.fromFragmentIndex, 0);
});

test('uncertain (prepared) turn requires reconciliation and never resumes or restarts', () => {
  const result = plan({ journalPhase: 'prepared' });
  assert.equal(result.action, 'reconcile-required');
  assert.notEqual(result.action, 'fresh-start');
  assert.notEqual(result.action, 'resume-stream');
});

test('uncertain (leased) turn requires reconciliation even when the stream looks mid-flight', () => {
  const result = plan({ journalPhase: 'leased', streamPhase: 'streaming', lastConfirmedFragment: 7 });
  assert.equal(result.action, 'reconcile-required');
});

test('settled turn is terminal; completed stream is marked complete', () => {
  const result = plan({ journalPhase: 'settled', streamPhase: 'finished' });
  assert.equal(result.action, 'terminal');
  if (result.action === 'terminal') {
    assert.equal(result.outcome, 'settled');
    assert.equal(result.streamComplete, true);
  }
});

test('settled turn with incomplete stream stays terminal and never resumes', () => {
  const result = plan({ journalPhase: 'settled', streamPhase: 'streaming' });
  assert.equal(result.action, 'terminal');
  if (result.action === 'terminal') {
    assert.equal(result.outcome, 'settled');
    assert.equal(result.streamComplete, false);
  }
});

test('cancelled and reconciled turns are terminal, not retryable', () => {
  const cancelled = plan({ journalPhase: 'cancelled' });
  assert.equal(cancelled.action, 'terminal');
  if (cancelled.action === 'terminal') assert.equal(cancelled.outcome, 'cancelled');
  const reconciled = plan({ journalPhase: 'reconciled' });
  assert.equal(reconciled.action, 'terminal');
  if (reconciled.action === 'terminal') assert.equal(reconciled.outcome, 'reconciled');
});

test('unknown journal phase fails closed', () => {
  const result = plan({ journalPhase: 'garbage' as never });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'unknown-phase');
});

test('aborted read is terminal and never resumes', () => {
  const result = plan({ streamPhase: 'aborted' });
  assert.equal(result.action, 'terminal');
  if (result.action === 'terminal') assert.equal(result.outcome, 'aborted');
});

test('finished read without journal entry is terminal', () => {
  const result = plan({ streamPhase: 'finished' });
  assert.equal(result.action, 'terminal');
  if (result.action === 'terminal') assert.equal(result.outcome, 'stream-finished');
});

test('connection generation mismatch rejects instead of resuming', () => {
  const result = planRecovery({
    record: record({ journalPhase: 'settled', streamPhase: 'finished' }),
    incoming: { ...incoming, connectionGeneration: 'gen-conn-2' },
    requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'generation-mismatch');
});

test('replaced tab generation rejects the stale binding', () => {
  const result = planRecovery({
    record: record(), incoming: { ...incoming, tabGeneration: 'gen-tab-2' },
    requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'tab-replaced');
});

test('session, provider and account mismatches reject the recovery', () => {
  for (const [field, reason] of [
    ['sessionID', 'session-mismatch'], ['providerID', 'provider-mismatch'], ['accountRef', 'account-mismatch'],
  ] as const) {
    const result = planRecovery({
      record: record(), incoming: { ...incoming, [field]: 'other-value' },
      requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
    });
    assert.equal(result.action, 'reject', field);
    if (result.action === 'reject') assert.equal(result.reason, reason);
  }
});

test('stale recorded turn rejects instead of resuming', () => {
  const result = planRecovery({
    record: record({ recordedAt: NOW - 120_000 }), incoming,
    requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'stale');
});

test('a different requested turn is rejected (cross-turn confusion)', () => {
  const result = planRecovery({
    record: record(), incoming, requestedTurnID: 'turn-other', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'turn-mismatch');
});

test('missing incoming connection rejects the recovery', () => {
  const result = planRecovery({
    record: record(), incoming: null, requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'no-incoming-connection');
});

test('malformed identifiers fail closed', () => {
  const result = planRecovery({
    record: record({ identity: { ...identity, tabID: 'tab id with spaces' } }),
    incoming, requestedTurnID: 'turn-r1', now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(result.action, 'reject');
  if (result.action === 'reject') assert.equal(result.reason, 'invalid-record');
});

test('fragments already confirmed are duplicates and must be dropped', () => {
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 5 }),
    { admit: false, reason: 'duplicate' });
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 2 }),
    { admit: false, reason: 'duplicate' });
});

test('the next sequential fragment is admitted on resume', () => {
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 6 }),
    { admit: true });
});

test('a gap in resumed fragments fails closed', () => {
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 8 }),
    { admit: false, reason: 'gap' });
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 0 }),
    { admit: false, reason: 'invalid' });
  assert.deepEqual(admitFragment({ streamPhase: 'streaming', lastConfirmedFragment: 5, seq: 1.5 }),
    { admit: false, reason: 'invalid' });
});

test('fragments after abandon or completion are never surfaced', () => {
  assert.deepEqual(admitFragment({ streamPhase: 'aborted', lastConfirmedFragment: 5, seq: 6 }),
    { admit: false, reason: 'abandoned' });
  assert.deepEqual(admitFragment({ streamPhase: 'finished', lastConfirmedFragment: 5, seq: 6 }),
    { admit: false, reason: 'abandoned' });
});

test('crash after engagement survives restart as uncertain: lock, then explicit reconciliation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-recovery-'));
  try {
    const claim: TabClaim = { sessionID: 'sess-j1', providerID: 'qwen', tabID: 'tab-j1', accountRef: 'acct-j1' };
    const secret = randomBytes(32).toString('hex');
    const crashed = DurableRelayJournal.open(dir, claim, secret);
    crashed.prepare('turn-crash');
    crashed.leased('turn-crash');
    // Abrupt crash: the process dies without closing; the lock remains and a
    // second open must refuse automatic takeover.
    assert.throws(
      () => DurableRelayJournal.open(dir, claim, secret),
      /locked: require explicit operator recovery/,
    );
    // Explicit operator recovery step: remove the stale lock, then reopen.
    unlinkSync(join(dir, '.lock'));
    const restarted = DurableRelayJournal.open(dir, claim, secret);
    try {
      const entry = restarted.status().find((e) => e.turnID === 'turn-crash');
      assert.equal(entry?.phase, 'leased');
      const result = planRecovery({
        record: record({ turnID: 'turn-crash', journalPhase: 'leased', streamPhase: 'streaming' }),
        incoming, requestedTurnID: 'turn-crash', now: NOW, maxAgeMs: 60_000,
      });
      assert.equal(result.action, 'reconcile-required');
      // The durable journal itself refuses to start a new turn while unresolved.
      assert.throws(() => restarted.prepare('turn-new'), /unresolved browser effects/);
      restarted.reconcile('turn-crash', {
        outcome: 'observed-applied', evidenceHash: 'b'.repeat(64), operatorID: 'operator-1', acknowledged: true,
      });
      assert.equal(restarted.status().find((e) => e.turnID === 'turn-crash')?.phase, 'reconciled');
      restarted.prepare('turn-new'); // only after explicit human attestation
    } finally {
      restarted.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
