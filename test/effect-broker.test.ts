import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ToolBroker } from '../src/core/tool-broker.js';
import { ConsentGate } from '../src/core/consent-gate.js';
import { buildAuthorityContext } from '../src/core/authority-context.js';
import { runAuthorizedEffect } from '../src/core/effect-broker.js';
import type { NativeEffectAuthority } from '../src/core/effect-broker.js';

const scope = {
  sessionID: 'sess-eb', agentID: 'agent-eb', turnID: 'turn-eb', workspaceID: 'ws-eb', callID: 'call-eb',
};

function context(overrides: Partial<Parameters<typeof buildAuthorityContext>[0]> = {}) {
  const r = buildAuthorityContext({
    pluginID: 'wb-eb', pluginGeneration: 'gen-1', agentID: scope.agentID, sessionID: scope.sessionID,
    workspaceID: scope.workspaceID, worktreeID: 'wt-eb', turnID: scope.turnID, callID: scope.callID,
    connectionID: 'conn-eb', connectionGeneration: 'cgen-1', tabID: 'tab-eb', tabGeneration: 'tgen-1',
    action: 'file.read', policyRevision: 'policy-1', authorityEpoch: 'epoch-1',
    ticketID: 'ticket-eb', ticketNonce: 'nonce-eb', deadline: 10_000,
    ...overrides,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  return r.context;
}

function consentedFixture(now = 1000) {
  const broker = new ToolBroker();
  const reserved = broker.reserve({
    proposalHash: 'a'.repeat(64), sessionID: scope.sessionID, agentID: scope.agentID,
    turnID: scope.turnID, workspaceID: scope.workspaceID, now,
  });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error('unreachable');
  const op = broker.consent(reserved.operation.operationID, now);
  assert.ok(op && op.status === 'consented');
  return { broker, op, gate: new ConsentGate('granted') };
}

const allow: NativeEffectAuthority = {
  attest: async (ctx) => ({ authorityEpoch: ctx.authorityEpoch, policyRevision: ctx.policyRevision }),
};

test('executes once through the full chain and records the executed receipt', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const result = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    { operationID: op.operationID, context: context(), execute: async () => { calls += 1; return 'read-ok'; } },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, 'executed');
    assert.equal(result.result, 'read-ok');
    assert.equal(result.operationID, op.operationID);
    assert.equal(result.attestation.authorityEpoch, 'epoch-1');
  }
  assert.equal(calls, 1);
  assert.equal(broker.get(op.operationID)?.status, 'executed');
});

test('no native authority (distributed default) refuses before any execution', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const result = await runAuthorizedEffect(
    { broker, gate, authority: null, now: () => 1500 },
    { operationID: op.operationID, context: context(), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'no-native-authority'); }
  assert.equal(calls, 0);
  assert.equal(broker.get(op.operationID)?.status, 'consented'); // retryable once the seam exists
});

test('a permission review alone is not execution authorization', async () => {
  const broker = new ToolBroker();
  const reserved = broker.reserve({
    proposalHash: 'b'.repeat(64), sessionID: scope.sessionID, agentID: scope.agentID,
    turnID: scope.turnID, workspaceID: scope.workspaceID, now: 1000,
  });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error('unreachable');
  let calls = 0;
  const result = await runAuthorizedEffect(
    { broker, gate: new ConsentGate('granted'), authority: allow, now: () => 1500 },
    { operationID: reserved.operation.operationID, context: context(), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'operation-not-consented'); }
  assert.equal(calls, 0);
});

test('a context from another session is refused (scope confusion)', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const result = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    { operationID: op.operationID, context: context({ sessionID: 'sess-intruder' }), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'scope-mismatch'); }
  assert.equal(calls, 0);
});

test('missing or mismatched attestation refuses execution', async () => {
  const cases: { authority: NativeEffectAuthority; reason: string }[] = [
    { authority: { attest: async () => null }, reason: 'authority-attestation-missing' },
    { authority: { attest: async (ctx) => ({ authorityEpoch: 'epoch-stale', policyRevision: ctx.policyRevision }) }, reason: 'authority-mismatch' },
    { authority: { attest: async (ctx) => ({ authorityEpoch: ctx.authorityEpoch, policyRevision: 'policy-stale' }) }, reason: 'authority-mismatch' },
  ];
  for (const { authority, reason } of cases) {
    const { broker, op, gate } = consentedFixture();
    let calls = 0;
    const result = await runAuthorizedEffect(
      { broker, gate, authority, now: () => 1500 },
      { operationID: op.operationID, context: context(), execute: async () => { calls += 1; return 'x'; } },
    );
    assert.equal(result.ok, false, reason);
    if (!result.ok && result.status === 'refused') assert.equal(result.reason, reason);
    else assert.fail(`expected refused for ${reason}`);
    assert.equal(calls, 0);
  }
});

test('revocation during pre-execution attestation refuses and never runs', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const authority: NativeEffectAuthority = {
    attest: async (ctx) => { gate.revoke(1200, 'revoked during attestation'); return { authorityEpoch: ctx.authorityEpoch, policyRevision: ctx.policyRevision }; },
  };
  const result = await runAuthorizedEffect(
    { broker, gate, authority, now: () => 1500 },
    { operationID: op.operationID, context: context(), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'consent-absent'); }
  assert.equal(calls, 0);
});

test('an expired ticket refuses even with consent and authority present', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const result = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    { operationID: op.operationID, context: context({ deadline: 1400 }), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'expired'); }
  assert.equal(calls, 0);
});

test('an unknown operation is refused', async () => {
  const { broker, gate } = consentedFixture();
  const result = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    { operationID: 'op-missing', context: context(), execute: async () => 'x' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'refused'); assert.equal(result.reason, 'operation-unknown'); }
});

test('executor failure yields uncertain, terminal operation, and blocks double execution', async () => {
  const { broker, op, gate } = consentedFixture();
  let calls = 0;
  const first = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    { operationID: op.operationID, context: context(), execute: async () => { calls += 1; throw new Error('browser died'); } },
  );
  assert.equal(first.ok, false);
  if (!first.ok) { assert.equal(first.status, 'uncertain'); assert.equal(first.reason, 'executor-failed'); }
  // The effect may have been applied; the operation is terminal and can never re-run.
  assert.equal(broker.get(op.operationID)?.status, 'uncertain');
  assert.equal(broker.fail(op.operationID, 'failed'), null); // uncertainty is not relabelable
  const second = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1600 },
    { operationID: op.operationID, context: context(), execute: async () => { calls += 1; return 'x'; } },
  );
  assert.equal(second.ok, false);
  if (!second.ok && second.status === 'refused') assert.equal(second.reason, 'operation-not-consented');
  assert.equal(calls, 1);
});

test('revocation during execution yields uncertain and never claims success', async () => {
  const { broker, op, gate } = consentedFixture();
  const result = await runAuthorizedEffect(
    { broker, gate, authority: allow, now: () => 1500 },
    {
      operationID: op.operationID, context: context(),
      execute: async () => { gate.revoke(1400, 'user revoked mid-effect'); return 'x'; },
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'revoked-during-execution'); }
  assert.equal(broker.get(op.operationID)?.status, 'uncertain');
});

test('authority lost after execution yields uncertain instead of claiming success', async () => {
  const { broker, op, gate } = consentedFixture();
  let attests = 0;
  const authority: NativeEffectAuthority = {
    attest: async (ctx) => {
      attests += 1;
      if (attests > 1) return null;
      return { authorityEpoch: ctx.authorityEpoch, policyRevision: ctx.policyRevision };
    },
  };
  const result = await runAuthorizedEffect(
    { broker, gate, authority, now: () => 1500 },
    { operationID: op.operationID, context: context(), execute: async () => 'ran' },
  );
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'authority-lost-after-execution'); }
  assert.equal(broker.get(op.operationID)?.status, 'uncertain');
});
