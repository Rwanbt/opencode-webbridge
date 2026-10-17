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
