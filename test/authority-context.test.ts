import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildAuthorityContext, isExpired, sameAuthority } from '../src/core/authority-context.js';

const base = {
  pluginID: 'opencode-webbridge', pluginGeneration: 'g1', agentID: 'agent-1',
  sessionID: 'sess-1', workspaceID: 'ws-1', worktreeID: 'wt-1', turnID: 'turn-1',
  callID: 'call-1', connectionID: 'conn-1', connectionGeneration: 'cg-1',
  tabID: 'tab-1', tabGeneration: 'tg-1', action: 'browser.read',
  policyRevision: 'pr-1', authorityEpoch: 'ae-1', ticketID: 'ticket-1',
  ticketNonce: 'nonce-ABCDEFGHIJKLMNOPQRSTUV', deadline: 5000,
};

test('complete authority context builds ok', () => {
  const r = buildAuthorityContext(base);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.context.sessionID, 'sess-1');
});

test('missing field fails closed', () => {
  const { sessionID, ...rest } = base;
  const r = buildAuthorityContext(rest);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /missing:sessionID/);
});

test('invalid opaque field fails', () => {
  const r = buildAuthorityContext({ ...base, pluginID: 'has space' });
  assert.equal(r.ok, false);
});

test('invalid deadline fails', () => {
  const r = buildAuthorityContext({ ...base, deadline: 0 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /invalid:deadline/);
});

test('isExpired respects deadline', () => {
  const r = buildAuthorityContext(base);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(isExpired(r.context, 4999), false);
    assert.equal(isExpired(r.context, 5000), true);
  }
});

test('sameAuthority detects any field change', () => {
  const a = buildAuthorityContext(base);
  const b = buildAuthorityContext({ ...base, tabGeneration: 'tg-2' });
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) assert.equal(sameAuthority(a.context, b.context), false);
  const c = buildAuthorityContext(base);
  if (a.ok && c.ok) assert.equal(sameAuthority(a.context, c.context), true);
});

test('authority is a frozen own-data snapshot, rejecting getters and extra asserted grants', () => {
  const good = buildAuthorityContext(base);
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.ok(Object.isFrozen(good.context));
    assert.throws(() => { (good.context as { sessionID: string }).sessionID = 'forged'; }, TypeError);
  }
  let reads = 0;
  const getter = Object.defineProperty({ ...base }, 'sessionID', {
    enumerable: true, get() { reads++; return 'sess-1'; },
  });
  const rejected = buildAuthorityContext(getter);
  assert.equal(rejected.ok, false);
  assert.equal(reads, 0);
  assert.equal(buildAuthorityContext({ ...base, attachProof: 'claimed-OS-attestation' } as never).ok, false);
});

test('sameAuthority binds exact expiry and invalid local clock cannot bypass deadlines', () => {
  const a = buildAuthorityContext(base);
  const b = buildAuthorityContext({ ...base, deadline: base.deadline + 1 });
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  assert.equal(sameAuthority(a.context, b.context), false);
  for (const clock of [NaN, Infinity, -Infinity, -1, 1.5]) {
    assert.equal(isExpired(a.context, clock), true, String(clock));
  }
});
