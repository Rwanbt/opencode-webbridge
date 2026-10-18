import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import { OfflineAdapterSession, type OfflineBinding } from '../src/testing/offline-adapter-session.js';
import { validateAdapterContract, isAdapterUsable, type AdapterContract } from '../src/core/adapter-contract.js';
import { disabledGate, evaluateGate, initialGates } from '../src/core/provider-gate.js';
import { redactSecrets, containsSecret } from '../src/core/secret-redactor.js';

// Per-provider offline benches. Fixture-only: no network, no provider site,
// no credential material. None of these assertions enables a commercial model.
for (const provider of WEB_PROVIDER_CATALOG) {
  const accountA: OfflineBinding = { providerID: provider.id, sessionID: 'bench_s1',
    accountRef: 'acct_a', tabID: 'tab_b1', connectionID: 'conn_b1', generation: 1 };
  const accountB: OfflineBinding = { ...accountA, accountRef: 'acct_b', connectionID: 'conn_b2' };

  test(`${provider.id}: capability detection stays fail-closed for offline use`, () => {
    const contract: AdapterContract = {
      identity: { providerID: provider.id, displayName: provider.name, origin: provider.origin },
      capabilities: { textInput: 'unknown', textOutput: 'unknown', streaming: 'unknown',
        tools: 'unknown', attachments: 'unknown', interruption: 'unknown' },
      policyDecision: 'restricted',
      approved: false,
    };
    // Structurally valid, never usable: no capability has been verified.
    assert.deepEqual(validateAdapterContract(contract), { ok: true });
    assert.equal(isAdapterUsable(contract), false);
    // The gate blocks at the first independent check and reports it exactly.
    assert.deepEqual(evaluateGate(disabledGate(provider.id)), { ready: false, reason: 'policy' });
    // All five providers start disabled with unreviewed policy and unknown capabilities.
    const startup = initialGates();
    assert.equal(startup.size, 5);
    const gate = startup.get(provider.id);
    assert.ok(gate);
    assert.equal(gate.policy, 'unreviewed');
    assert.equal(gate.streaming, 'unknown');
    assert.equal(evaluateGate(gate).ready, false);
  });

  test(`${provider.id}: accounts are isolated; a change of account can never inherit state`, () => {
    const sessionA = new OfflineAdapterSession(provider.id);
    const sessionB = new OfflineAdapterSession(provider.id);
    sessionA.pair(accountA);
    sessionB.pair(accountB);

    // Cross-account observations and fragment writes are refused by both sides.
    assert.throws(() => sessionA.observe({ binding: accountB, signedIn: true }), /owner/);
    assert.throws(() => sessionB.observe({ binding: accountA, signedIn: true }), /owner/);

    sessionA.observe({ binding: accountA, signedIn: true });
    sessionA.start(accountA, 't-shared');
    sessionA.progress(accountA, { turnID: 't-shared', seq: 1, text: 'a-only' });
    assert.equal(sessionA.finish(accountA, 't-shared', 'a-only'), 'a-only');
    assert.throws(() => sessionA.progress(accountB, { turnID: 't-shared', seq: 1, text: 'x' }), /owner/);

    // Account B's session never saw A's spent turn: its own bookkeeping is separate.
    sessionB.observe({ binding: accountB, signedIn: true });
    sessionB.start(accountB, 't-shared');
    sessionB.progress(accountB, { turnID: 't-shared', seq: 1, text: 'b-only' });
    assert.equal(sessionB.finish(accountB, 't-shared', 'b-only'), 'b-only');

    // There is no legitimate switch path: observe and reconnect both pin the account.
    assert.throws(() => sessionA.observe({ binding: accountB, signedIn: true }), /owner/);
    assert.throws(() => sessionA.reconnect(accountA, { ...accountB, generation: 2 }), /mismatch/);
  });

  test(`${provider.id}: expired or stale material is never surfaced or replayed`, () => {
    const session = new OfflineAdapterSession(provider.id);
    session.pair(accountA);
    session.observe({ binding: accountA, signedIn: true });
    session.start(accountA, 't1');
    session.progress(accountA, { turnID: 't1', seq: 1, text: 'ok' });
    session.finish(accountA, 't1', 'ok');

    // Late or duplicated fragments after the terminal state are refused.
    assert.throws(() => session.progress(accountA, { turnID: 't1', seq: 1, text: 'late' }), /not streaming/);
    assert.throws(() => session.finish(accountA, 't1', 'ok'), /terminal mismatch/);

    // A stale generation can never act on the current binding.
    assert.throws(() => session.observe({ binding: { ...accountA, generation: 0 }, signedIn: true }), /owner/);
    assert.throws(() => session.progress({ ...accountA, generation: 2 }, { turnID: 't1', seq: 2, text: 'x' }), /owner/);

    // Reconnection expires the previous observation: re-observation is required,
    // the old binding is inert, and generation can only move forward.
    const next = { ...accountA, connectionID: 'conn_b9', generation: 2 };
    session.reconnect(accountA, next);
    assert.throws(() => session.start(next, 't2'), /not ready/);
    assert.throws(() => session.start(accountA, 't2'), /owner/); // the expired binding is inert
    assert.throws(() => session.observe({ binding: accountA, signedIn: true }), /owner/);
    assert.throws(() => session.reconnect(next, { ...next, connectionID: 'conn_b8', generation: 1 }), /mismatch/);

    // An interrupted turn is uncertain: no claim of not-applied, no blind replay.
    session.observe({ binding: next, signedIn: true });
    session.start(next, 't2');
    session.progress(next, { turnID: 't2', seq: 1, text: 'partial' });
    session.interrupt(next);
    assert.throws(() => session.finish(next, 't2', 'partial'), /terminal mismatch/);
    assert.throws(() => session.start(next, 't2'), /not ready/);
    assert.throws(() => session.reconcile(next, { turnID: 't2', outcome: 'observed-applied', hash: 'nope' }), /evidence/);
    session.reconcile(next, { turnID: 't2', outcome: 'observed-not-applied', hash: 'e'.repeat(64) });
    session.observe({ binding: next, signedIn: true });
    assert.throws(() => session.start(next, 't2'), /already spent/);
  });

  test(`${provider.id}: provider diagnostics never expose secrets, accounts stay logical`, () => {
    const token = 'a'.repeat(40);
    const urlSecret = 'b'.repeat(32);
    const line = `[${provider.id}] account=${accountA.accountRef} session=${accountA.sessionID} ` +
      `Authorization: Bearer ${token} https://example.invalid/cb?access_token=${urlSecret}`;
    // Detection is stateless: repeated checks cannot miss the same secret.
    assert.equal(containsSecret(line), true);
    assert.equal(containsSecret(line), true);
    const r = redactSecrets(line);
    assert.equal(r.text.includes(token), false);
    assert.equal(r.text.includes(urlSecret), false);
    assert.equal(r.text.includes(`[${provider.id}]`), true);
    assert.ok(r.redactions >= 2);
  });
}
