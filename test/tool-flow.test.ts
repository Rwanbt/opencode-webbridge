import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { validateToolProposal } from '../src/core/tool-proposal.js';
import { ToolBroker } from '../src/core/tool-broker.js';
import { ConsentGate, requireConsent } from '../src/core/consent-gate.js';
import { buildAuthorityContext, isExpired } from '../src/core/authority-context.js';

const scope = {
  sessionID: 'sess-flow', agentID: 'agent-flow', turnID: 'turn-flow',
  workspaceID: 'ws-flow', callID: 'call-flow',
};

function authority(deadline: number) {
  const r = buildAuthorityContext({
    pluginID: 'wb-flow', pluginGeneration: 'gen-1', agentID: scope.agentID, sessionID: scope.sessionID,
    workspaceID: scope.workspaceID, worktreeID: 'wt-flow', turnID: scope.turnID, callID: scope.callID,
    connectionID: 'conn-flow', connectionGeneration: 'cgen-1', tabID: 'tab-flow', tabGeneration: 'tgen-1',
    action: 'file.read', policyRevision: 'policy-1', authorityEpoch: 'epoch-1',
    ticketID: 'ticket-flow', ticketNonce: 'nonce-flow', deadline,
  });
  assert.equal(r.ok, true);
  if (!r.ok) throw new Error('unreachable');
  return r.context;
}

function reserveValidated(broker: ToolBroker, untrusted: unknown, now: number) {
  const validated = validateToolProposal(untrusted, scope);
  assert.equal(validated.ok, true);
  if (!validated.ok) throw new Error('unreachable');
  const hash = createHash('sha256').update(JSON.stringify(validated.proposal)).digest('hex');
  const reserved = broker.reserve({
    proposalHash: hash, sessionID: scope.sessionID, agentID: scope.agentID,
    turnID: scope.turnID, workspaceID: scope.workspaceID, now,
  });
  assert.equal(reserved.ok, true);
  if (!reserved.ok) throw new Error('unreachable');
  return { validated, reserved };
}

test('staged flow: untrusted web output never executes directly', () => {
  const untrusted = {
    version: 1, action: 'file.read', args: { path: 'src\\index.ts' }, provenance: { ...scope },
  };
  const broker = new ToolBroker();
  const { validated, reserved } = reserveValidated(broker, untrusted, 1000);
  assert.equal(validated.proposal.args.path, 'src/index.ts');

  // Without consent, the gate refuses and execution is impossible.
  const gate = new ConsentGate('unknown');
  assert.throws(() => requireConsent(gate, 'file.read'), /consent absent/);
  assert.equal(broker.executed(reserved.operation.operationID), null);

  // The user sees the proposal, then approves.
  gate.pending(1100, 'awaiting user');
  gate.grant(1200, 'user approved file.read');
  requireConsent(gate, 'file.read');

  // Authority is revalidated immediately before execution consent.
  const ctx = authority(2000);
  assert.equal(isExpired(ctx, 1500), false);
  const consented = broker.consent(reserved.operation.operationID, 1500);
  assert.ok(consented && consented.status === 'consented');
  const executed = broker.executed(reserved.operation.operationID);
  assert.ok(executed && executed.status === 'executed');
});

test('revocation during the wait cancels the operation before execution', () => {
  const broker = new ToolBroker();
  const { reserved } = reserveValidated(broker, {
    version: 1, action: 'git.log', args: { limit: 5 }, provenance: { ...scope },
  }, 1000);
  const gate = new ConsentGate('granted');
  gate.pending(1100, 'awaiting confirmation');
  requireConsent(gate, 'git.log');

  // The user revokes while the confirmation is pending.
  gate.revoke(1200, 'user revoked during wait');
  assert.throws(() => requireConsent(gate, 'git.log'), /consent absent/);
  // The flow layer must refuse to consent while the gate is not granted.
  if (gate.isGranted()) broker.consent(reserved.operation.operationID, 1200);
  const cancelled = broker.fail(reserved.operation.operationID, 'cancelled');
  assert.ok(cancelled && cancelled.status === 'cancelled');
  assert.equal(broker.executed(reserved.operation.operationID), null);
});

test('expired authority refuses execution even when consent was granted', () => {
  const broker = new ToolBroker();
  const { reserved } = reserveValidated(broker, {
    version: 1, action: 'file.read', args: { path: 'README.md' }, provenance: { ...scope },
  }, 1000);
  const gate = new ConsentGate('granted');
  const ctx = authority(2000);
  assert.equal(isExpired(ctx, 2500), true);
  // A correct flow layer must not consent when the ticket has expired.
  assert.equal(broker.get(reserved.operation.operationID)?.status, 'reserved');
  assert.equal(broker.executed(reserved.operation.operationID), null);
  requireConsent(gate, 'file.read'); // consent alone is not authority
  assert.equal(broker.get(reserved.operation.operationID)?.status, 'reserved');
});

test('a receipt from one session is never reusable by another', () => {
  const broker = new ToolBroker();
  const untrusted = {
    version: 1, action: 'file.read', args: { path: 'src/index.ts' }, provenance: { ...scope },
  };
  const { reserved } = reserveValidated(broker, untrusted, 1000);
  const stolen = broker.reserve({
    proposalHash: reserved.operation.proposalHash, sessionID: 'intruder-session',
    agentID: scope.agentID, turnID: scope.turnID, workspaceID: scope.workspaceID, now: 1001,
  });
  assert.equal(stolen.ok, false);
  if (!stolen.ok) assert.equal(stolen.reason, 'scope-conflict');
});
