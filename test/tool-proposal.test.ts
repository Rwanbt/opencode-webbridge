import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateToolProposal, isReadOnlyAction, isMutableAction } from '../src/core/tool-proposal.js';

const scope = { sessionID: 'sess-tp', agentID: 'agent-tp', turnID: 'turn-tp', workspaceID: 'ws-tp', callID: 'call-tp' };

function mk(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    action: 'file.read',
    args: { path: 'src/index.ts' },
    provenance: { ...scope },
    ...overrides,
  };
}

test('valid read-only proposal passes', () => {
  const r = validateToolProposal(mk(), scope);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.proposal.action, 'file.read');
});

test('mutable action is rejected', () => {
  const r = validateToolProposal(mk({ action: 'terminal.exec' }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'mutable-action');
});

test('unknown action is rejected', () => {
  const r = validateToolProposal(mk({ action: 'foo.bar' }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'unknown-action');
});

test('bad version is rejected', () => {
  const r = validateToolProposal(mk({ version: 2 }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-version');
});

test('scope mismatch is rejected', () => {
  const r = validateToolProposal(mk({ provenance: { ...scope, sessionID: 'other' } }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'scope-mismatch');
});

test('path traversal is rejected', () => {
  const r = validateToolProposal(mk({ args: { path: '../secret.txt' } }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.reason === 'path-traversal' || r.reason === 'bad-args', r.reason);
});

test('absolute path is rejected', () => {
  const r = validateToolProposal(mk({ args: { path: '/etc/passwd' } }), scope);
  assert.equal(r.ok, false);
});

test('bad provenance is rejected', () => {
  const r = validateToolProposal(mk({ provenance: 'x' }), scope);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-provenance');
});

test('git.read-only actions validate', () => {
  for (const action of ['git.status', 'git.diff', 'git.log']) {
    const r = validateToolProposal(mk({ action, args: {} }), scope);
    assert.equal(r.ok, true, action);
  }
});

test('isReadOnlyAction / isMutableAction classify correctly', () => {
  assert.equal(isReadOnlyAction('file.read'), true);
  assert.equal(isReadOnlyAction('terminal.exec'), false);
  assert.equal(isMutableAction('terminal.exec'), true);
  assert.equal(isMutableAction('file.read'), false);
});

test('web-authored getters and toJSON are never invoked during proposal validation', () => {
  let invoked = 0;
  const evilArg = Object.defineProperty({ path: 'src/index.ts' }, 'toJSON', {
    enumerable: false, get() { invoked++; throw new Error('hostile toJSON'); },
  });
  const evilPath = { get path() { invoked++; return 'src/index.ts'; } };
  const evilAction = Object.defineProperty(mk(), 'action', {
    enumerable: true, get() { invoked++; return 'file.read'; },
  });
  const evilProvenance = { ...scope, get sessionID() { invoked++; return scope.sessionID; } };
  for (const raw of [
    mk({ args: evilArg }), mk({ args: evilPath }), evilAction,
    mk({ provenance: evilProvenance }),
  ]) assert.equal(validateToolProposal(raw, scope).ok, false);
  assert.equal(invoked, 0);
});

test('web tool proposals reject hidden payload fields and unexpected authority metadata', () => {
  for (const raw of [
    mk({ args: { path: 'src/index.ts', command: 'rm -rf .' } }),
    mk({ args: { path: 'src/index.ts', __proto__: null, hidden: 'secret' } }),
    mk({ action: 'git.status', args: { limit: 2, shell: 'whoami' } }),
    mk({ provenance: { ...scope, connectionID: 'forged' } }),
    { ...mk(), grantId: 'claimedNativeApproval' },
  ]) assert.equal(validateToolProposal(raw, scope).ok, false);
});

test('validated tool proposal is deeply detached and cannot be retargeted after admission', () => {
  const raw = mk();
  const r = validateToolProposal(raw, scope);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  (raw.args as { path: string }).path = 'src/other.ts';
  (raw.provenance as { sessionID: string }).sessionID = 'hijack';
  assert.equal(r.proposal.args.path, 'src/index.ts');
  assert.equal(r.proposal.provenance.sessionID, scope.sessionID);
  assert.ok(Object.isFrozen(r.proposal));
  assert.ok(Object.isFrozen(r.proposal.provenance));
  assert.ok(Object.isFrozen(r.proposal.args));
});

test('prototype, hidden symbol and non-primitive arguments cannot smuggle capability metadata', () => {
  const inherited = Object.create({ path: 'src/index.ts' }) as { path: string };
  const symbolArg = { path: 'src/index.ts', [Symbol.for('extra-capability')]: true };
  const withHidden = Object.defineProperty({ path: 'src/index.ts' }, 'effect', {
    value: 'terminal.exec', enumerable: false,
  });
  for (const args of [inherited, symbolArg, withHidden, { path: { toString: () => 'src/index.ts' } }]) {
    assert.equal(validateToolProposal(mk({ args }), scope).ok, false);
  }
  const clean = validateToolProposal(mk({ action: 'git.diff', args: { path: 'src\\ok.ts', staged: true } }), scope);
  assert.equal(clean.ok, true);
  if (clean.ok) assert.deepEqual(clean.proposal.args, { path: 'src/ok.ts', staged: true });
});
