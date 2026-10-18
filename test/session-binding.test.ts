import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SessionBindingRegistry } from '../src/core/session-binding.js';

const base = { sessionID: 'sess-1', providerID: 'qwen', accountRef: 'acct-1', tabID: 'tab-1', tabGeneration: 'tg-1', now: 1000 };

test('binds a tab to a session', () => {
  const reg = new SessionBindingRegistry();
  const r = reg.bind(base);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.binding.sessionID, 'sess-1');
});

test('same session cannot bind a second tab', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  const r = reg.bind({ ...base, tabID: 'tab-2', tabGeneration: 'tg-2' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'already-bound');
});

test('same tab cannot serve a different account', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  const r = reg.bind({ ...base, sessionID: 'sess-2', accountRef: 'acct-2' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'account-mismatch');
});

test('tab replacement invalidates the old binding', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  const r = reg.bind({ ...base, tabGeneration: 'tg-2' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'tab-replaced');
  assert.equal(reg.lookup('sess-1'), undefined);
});

test('closing a tab invalidates the binding', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  assert.equal(reg.closeTab('tab-1'), true);
  assert.equal(reg.lookup('sess-1'), undefined);
  assert.equal(reg.closeTab('tab-1'), false);
});

test('invalid ids are rejected', () => {
  const reg = new SessionBindingRegistry();
  const r = reg.bind({ ...base, sessionID: 'bad space' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'invalid-id');
});

test('same tab/account/session cannot silently rebind to another provider', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  const r = reg.bind({ ...base, providerID: 'gemini' });
  assert.equal(r.ok, false);
  assert.equal(reg.lookup('sess-1')?.providerID, 'qwen');
});

test('returned binding cannot be mutated to forge provider, account or tab owner', () => {
  const reg = new SessionBindingRegistry();
  const result = reg.bind(base);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.throws(() => { (result.binding as { providerID: string }).providerID = 'gemini'; }, TypeError);
    assert.throws(() => { (result.binding as { accountRef: string }).accountRef = 'other'; }, TypeError);
  }
  const found = reg.lookup('sess-1');
  assert.ok(found);
  assert.throws(() => { (found as { tabID: string }).tabID = 'other'; }, TypeError);
  assert.equal(reg.lookup('sess-1')?.tabID, 'tab-1');
});

test('idempotent same owner bind does not reset the original binding age', () => {
  const reg = new SessionBindingRegistry();
  assert.equal(reg.bind(base).ok, true);
  const repeated = reg.bind({ ...base, now: 2000 });
  assert.equal(repeated.ok, true);
  assert.equal(reg.lookup('sess-1')?.boundAt, 1000);
});

test('browser-authored getters cannot execute during new tab binding', () => {
  const reg = new SessionBindingRegistry();
  let reads = 0;
  const injected = { ...base };
  Object.defineProperty(injected, 'accountRef', { enumerable: true, get() { reads++; return 'acct-1'; } });
  const result = reg.bind(injected);
  assert.deepEqual(result, { ok: false, reason: 'invalid-id' });
  assert.equal(reads, 0);
  assert.equal(reg.size(), 0);
});

test('unknown synthetic provider identifier is not accepted as a valid account binding', () => {
  const reg = new SessionBindingRegistry();
  assert.deepEqual(reg.bind({ ...base, providerID: 'forged' }), { ok: false, reason: 'invalid-id' });
  assert.equal(reg.size(), 0);
});
