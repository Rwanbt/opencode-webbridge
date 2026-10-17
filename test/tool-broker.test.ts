import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ToolBroker } from '../src/core/tool-broker.js';

const base = { proposalHash: 'hash-abcdefghij', sessionID: 's', agentID: 'a', turnID: 't', workspaceID: 'w', now: 1 };

test('reserve issues a new operation', () => {
  const b = new ToolBroker();
  const r = b.reserve(base);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reused, false);
    assert.equal(r.operation.status, 'reserved');
  }
});

test('same proposal hash reuses reservation', () => {
  const b = new ToolBroker();
  const r1 = b.reserve(base);
  const r2 = b.reserve(base);
  assert.equal(r1.ok && r2.ok, true);
  if (r1.ok && r2.ok) {
    assert.equal(r1.operation.operationID, r2.operation.operationID);
    assert.equal(r2.reused, true);
  }
});

test('different proposal gets new id', () => {
  const b = new ToolBroker();
  const r1 = b.reserve(base);
  const r2 = b.reserve({ ...base, proposalHash: 'hash-zyxwvutsrq' });
  assert.equal(r1.ok && r2.ok, true);
  if (r1.ok && r2.ok) assert.notEqual(r1.operation.operationID, r2.operation.operationID);
});

test('consent then execute transitions', () => {
  const b = new ToolBroker();
  const r = b.reserve(base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const c = b.consent(r.operation.operationID, 2);
  assert.ok(c && c.status === 'consented');
  const e = b.executed(r.operation.operationID);
  assert.ok(e && e.status === 'executed');
  // executed is terminal: cannot fail afterwards
  assert.equal(b.fail(r.operation.operationID, 'cancelled'), null);
});

test('execute without consent fails', () => {
  const b = new ToolBroker();
  const r = b.reserve(base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(b.executed(r.operation.operationID), null);
});

test('invalid input rejected', () => {
  const b = new ToolBroker();
  const r = b.reserve({ ...base, proposalHash: 'short' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid-input');
});

test('capacity enforced', () => {
  const b = new ToolBroker(1);
  assert.equal(b.reserve(base).ok, true);
  const r2 = b.reserve({ ...base, proposalHash: 'hash-2222222222' });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.reason, 'capacity');
});

test('same proposal hash under a different scope is rejected, never silently reused', () => {
  const b = new ToolBroker();
  assert.equal(b.reserve(base).ok, true);
  for (const changed of [
    { sessionID: 'other-session' }, { agentID: 'other-agent' },
    { turnID: 'other-turn' }, { workspaceID: 'other-workspace' },
  ]) {
    const r = b.reserve({ ...base, ...changed });
    assert.equal(r.ok, false, JSON.stringify(changed));
    if (!r.ok) assert.equal(r.reason, 'scope-conflict');
  }
});

test('a cross-session caller can never obtain another session receipt', () => {
  const b = new ToolBroker();
  const r1 = b.reserve(base); // session 's'
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const blocked = b.reserve({ ...base, sessionID: 'intruder' });
  assert.equal(blocked.ok, false);
  // The original reservation still executes only under its own scope.
  const c = b.consent(r1.operation.operationID, 2);
  assert.ok(c && c.status === 'consented' && c.sessionID === 's');
  const e = b.executed(r1.operation.operationID);
  assert.ok(e && e.status === 'executed');
});

test('an uncertain operation is terminal: never relabelled, never retried', () => {
  const b = new ToolBroker();
  const r = b.reserve(base);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(b.uncertain(r.operation.operationID), null); // only from consented
  b.consent(r.operation.operationID, 2);
  const u = b.uncertain(r.operation.operationID);
  assert.ok(u && u.status === 'uncertain');
  // Terminal: never relabelled applied/not-applied, never re-consented, never re-run.
  assert.equal(b.fail(r.operation.operationID, 'failed'), null);
  assert.equal(b.executed(r.operation.operationID), null);
  assert.equal(b.consent(r.operation.operationID, 3), null);
  assert.equal(b.uncertain(r.operation.operationID), null);
});
