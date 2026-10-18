import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import { RpcRelayPort } from '../src/core/rpc-relay-port.js';
import { ConsentGate, requireConsent } from '../src/core/consent-gate.js';
import { planRecovery } from '../src/core/session-recovery-coordinator.js';
import type { RecoveryIdentity } from '../src/core/session-recovery-coordinator.js';
import type { TabClaim } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'restart-s1', providerID: 'qwen', tabID: 'tab-r2', accountRef: 'acct-r2' };
const secret = randomBytes(32).toString('hex');
const identity: RecoveryIdentity = {
  sessionID: claim.sessionID, providerID: claim.providerID, tabID: claim.tabID, accountRef: claim.accountRef,
  tabGeneration: 'gen-tab-r2', connectionID: 'conn-r2', connectionGeneration: 'gen-conn-r2',
};

function isolated(fn: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-restart-scenarios-'));
  const run = Promise.resolve().then(() => fn(dir));
  return run.finally(() => rmSync(dir, { recursive: true, force: true }));
}

test('crash mid-commit leaves an orphan temp that is ignored: only the last committed state counts', async () => {
  await isolated((dir) => {
    const first = DurableRelayJournal.open(dir, claim, secret);
    first.prepare('turn-a');
    first.leased('turn-a');
    first.close();
    // A half-finished commit would have left a temp payload, never adopted.
    const forged: { entries: { phase: string }[] } = JSON.parse(readFileSync(join(dir, 'journal.json'), 'utf8'));
    forged.entries[0]!.phase = 'settled';
    writeFileSync(join(dir, '.journal-abandoned.tmp'), JSON.stringify(forged));
    const reopened = DurableRelayJournal.open(dir, claim, secret);
    try {
      assert.deepEqual(reopened.status(), [{ turnID: 'turn-a', phase: 'leased' }]);
      assert.throws(() => reopened.prepare('turn-new'), /unresolved/);
    } finally { reopened.close(); }
  });
});

test('truncated journal is refused, releases its lock, and a restored checkpoint reopens', async () => {
  await isolated((dir) => {
    const first = DurableRelayJournal.open(dir, claim, secret);
    first.prepare('t1');
    first.close();
    const path = join(dir, 'journal.json');
    const valid = readFileSync(path, 'utf8');
    writeFileSync(path, valid.slice(0, Math.max(1, Math.floor(valid.length / 2))));
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /invalid journal/);
    // The refused open must not strand its lock: an operator can retry.
    assert.equal(existsSync(join(dir, '.lock')), false);
    writeFileSync(path, valid);
    const reopened = DurableRelayJournal.open(dir, claim, secret);
    try {
      assert.deepEqual(reopened.status(), [{ turnID: 't1', phase: 'prepared' }]);
    } finally { reopened.close(); }
  });
});

test('truncated independent witness fails closed as a witness fault, never as a journal fault', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-restart-scenarios-'));
  const dir = join(root, 'journal');
  const witnessDir = join(root, 'independent-witness');
  try {
    const first = DurableRelayJournal.open(dir, claim, secret, witnessDir);
    first.prepare('w1');
    first.close();
    const witnessPath = join(witnessDir, 'witness.json');
    const valid = readFileSync(witnessPath, 'utf8');
    writeFileSync(witnessPath, valid.slice(0, 10));
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret, witnessDir), /witness/i);
    assert.equal(existsSync(join(dir, '.lock')), false);
    writeFileSync(witnessPath, valid);
    const reopened = DurableRelayJournal.open(dir, claim, secret, witnessDir);
    try {
      assert.deepEqual(reopened.status(), [{ turnID: 'w1', phase: 'prepared' }]);
    } finally { reopened.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a session change (or provider/tab change) cannot adopt another session journal', async () => {
  await isolated((dir) => {
    const first = DurableRelayJournal.open(dir, claim, secret);
    first.prepare('owned-1');
    first.close();
    for (const changed of [
      { ...claim, sessionID: 'restart-s2' },
      { ...claim, providerID: 'deepseek' },
      { ...claim, tabID: 'tab-elsewhere' },
    ] as TabClaim[]) {
      assert.throws(() => DurableRelayJournal.open(dir, changed, secret), /binding/);
    }
    const reopened = DurableRelayJournal.open(dir, claim, secret);
    try { assert.deepEqual(reopened.status(), [{ turnID: 'owned-1', phase: 'prepared' }]); }
    finally { reopened.close(); }
  });
});

test('revocation survives restart: no resume, no replay, reconciliation and fresh consent both required', async () => {
  await isolated(async (dir) => {
    const gate = new ConsentGate('granted');
    requireConsent(gate, 'browser read');
    const journal1 = DurableRelayJournal.open(dir, claim, secret);
    const relay1 = new RpcRelayPort(secret, journal1);
    await relay1.claim(claim);
    await relay1.submit(claim, { turnID: 'turn-rev', prompt: 'p' });
    assert.equal(relay1.take(secret, claim)?.turnID, 'turn-rev');
    relay1.progress(secret, claim, 'turn-rev', 1, 'partial');

    // The user revokes consent mid-stream; the flow layer must refuse data.
    gate.revoke(1, 'user revoked');
    assert.throws(() => requireConsent(gate, 'browser read'), /consent absent/);

    // Crash: the journal was never closed; its lock never self-clears.
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /locked/);
    unlinkSync(join(dir, '.lock')); // explicit operator step: no live owner verified

    const journal2 = DurableRelayJournal.open(dir, claim, secret);
    try {
      assert.equal(journal2.status().find((entry) => entry.turnID === 'turn-rev')?.phase, 'leased');

      // Restart starts from a blank consent state: nothing is implicitly granted.
      const gate2 = new ConsentGate();
      assert.throws(() => requireConsent(gate2, 'browser read'), /consent absent/);

      // Even a fresh grant cannot bypass reconciliation of the engaged turn.
      gate2.grant(2, 'fresh approval after restart');
      requireConsent(gate2, 'browser read');
      const decision = planRecovery({
        record: {
          turnID: 'turn-rev', identity, recordedAt: 2_000, journalPhase: 'leased',
          streamPhase: 'streaming', lastConfirmedFragment: 0,
        },
        incoming: identity, requestedTurnID: 'turn-rev', now: 2_100, maxAgeMs: 60_000,
      });
      assert.equal(decision.action, 'reconcile-required');

      const relay2 = new RpcRelayPort(secret, journal2);
      await relay2.claim(claim);
      await assert.rejects(relay2.submit(claim, { turnID: 'turn-rev', prompt: 'p' }), /already recorded/);
      await assert.rejects(relay2.submit(claim, { turnID: 'turn-new', prompt: 'n' }), /unresolved/);

      // Only explicit operator attestation then a fresh authorized turn proceed.
      journal2.reconcile('turn-rev', {
        outcome: 'observed-not-applied', evidenceHash: 'c'.repeat(64), operatorID: 'operator-2', acknowledged: true,
      });
      await relay2.submit(claim, { turnID: 'turn-new', prompt: 'n' });
      assert.equal(relay2.take(secret, claim)?.turnID, 'turn-new');
      relay2.progress(secret, claim, 'turn-new', 1, 'ok');
      relay2.complete(secret, claim, 'turn-new', 'ok');
      assert.equal(journal2.status().find((entry) => entry.turnID === 'turn-new')?.phase, 'settled');
    } finally { journal2.close(); }
  });
});

test('journal advanced but witness stale (crash between rename and witness write) is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-restart-scenarios-'));
  const dir = join(root, 'journal');
  const witnessDir = join(root, 'independent-witness');
  try {
    const first = DurableRelayJournal.open(dir, claim, secret, witnessDir);
    first.prepare('t1');
    first.close();
    const staleWitness = readFileSync(join(witnessDir, 'witness.json'), 'utf8');
    const second = DurableRelayJournal.open(dir, claim, secret, witnessDir);
    second.leased('t1'); // journal.json advanced; its witness was written too
    second.close();
    writeFileSync(join(witnessDir, 'witness.json'), staleWitness); // simulate the torn crash window
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret, witnessDir), /witness|rollback/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
