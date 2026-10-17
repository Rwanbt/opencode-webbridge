import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeWorkspacePath } from '../src/core/workspace-path.js';
import { validateToolProposal } from '../src/core/tool-proposal.js';

const scope = { sessionID: 'sess-wp', agentID: 'agent-wp', turnID: 'turn-wp', workspaceID: 'ws-wp', callID: 'call-wp' };

function read(path: unknown) {
  return validateToolProposal({ version: 1, action: 'file.read', args: { path }, provenance: { ...scope } }, scope);
}

test('normalizes backslashes and duplicate separators to posix form', () => {
  assert.equal(normalizeWorkspacePath('src\\sub\\file.ts'), 'src/sub/file.ts');
  assert.equal(normalizeWorkspacePath('src//file.ts'), 'src/file.ts');
  assert.equal(normalizeWorkspacePath('src/sub/file.ts'), 'src/sub/file.ts');
  assert.equal(normalizeWorkspacePath('file.ts'), 'file.ts');
});

test('benign dotted names are accepted (no false traversal positives)', () => {
  assert.equal(normalizeWorkspacePath('a..b/c.ts'), 'a..b/c.ts');
  assert.equal(normalizeWorkspacePath('..a/b.ts'), '..a/b.ts');
  assert.equal(normalizeWorkspacePath('a/b..c.ts'), 'a/b..c.ts');
});

test('UNC, backslash-root, forward-root and drive forms are rejected', () => {
  for (const bad of [
    '\\\\server\\share\\secret',            // UNC
    '//server/share/secret',                // posix-ish UNC
    '\\Windows\\System32\\drivers',         // backslash root-relative
    '/etc/passwd',
    'C:/Windows/System32',
    'C:\\Windows',
    'C:secret.txt',                         // drive-relative
    'z:file',
  ]) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    const r = read(bad);
    assert.equal(r.ok, false, bad);
  }
});

test('alternate data streams and colon confusion are rejected', () => {
  for (const bad of ['notes.txt:hidden', 'a/b:c', ':stream']) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    assert.equal(read(bad).ok, false, bad);
  }
});

test('Windows trailing dot/space aliasing is rejected', () => {
  for (const bad of ['secret.', 'secret ', 'dir /file.ts', 'dir/secret. ', 'dir/.', 'dir/ ']) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    assert.equal(read(bad).ok, false, bad);
  }
});

test('reserved device names are rejected case-insensitively, with or without extension', () => {
  for (const bad of ['CON', 'con.txt', 'NUL', 'nul.bak', 'COM1', 'com9.log', 'LPT1', 'aux', 'PRN.md', 'a/COM3']) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    assert.equal(read(bad).ok, false, bad);
  }
  // Look-alikes that are NOT device names remain valid.
  assert.equal(normalizeWorkspacePath('console.ts'), 'console.ts');
  assert.equal(normalizeWorkspacePath('com10.txt'), 'com10.txt');
});

test('control characters anywhere are rejected', () => {
  for (const bad of ['a\u0001b.ts', 'a\nb.ts', 'a\tb.ts', 'a\u007fb.ts']) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    assert.equal(read(bad).ok, false, bad);
  }
});

test('traversal and dot-only segments are rejected', () => {
  for (const bad of ['..', '../x', 'a/../b', 'a/..', '...', 'a/.../b', './a.ts', 'a/./b.ts']) {
    assert.equal(normalizeWorkspacePath(bad), null, bad);
    assert.equal(read(bad).ok, false, bad);
  }
});

test('empty, whitespace-only, trailing-slash and oversized forms are rejected', () => {
  for (const bad of ['', '   ', 'a/', 'dir/', '//', 'x'.repeat(4097), Array(66).fill('d').join('/')]) {
    assert.equal(normalizeWorkspacePath(bad), null, typeof bad === 'string' ? bad.slice(0, 24) : bad);
  }
  assert.equal(normalizeWorkspacePath('a'.repeat(256)), null); // segment too long
});

test('validated proposals carry the normalized posix path', () => {
  const r = read('src\\core//file.ts');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.proposal.args.path, 'src/core/file.ts');
  const ok = read('src/index.ts');
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.proposal.args.path, 'src/index.ts');
});

test('git.diff path uses the same strict contract', () => {
  const bad = validateToolProposal(
    { version: 1, action: 'git.diff', args: { path: 'C:secret' }, provenance: { ...scope } }, scope);
  assert.equal(bad.ok, false);
  const good = validateToolProposal(
    { version: 1, action: 'git.diff', args: { path: 'src\\a.ts' }, provenance: { ...scope } }, scope);
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.proposal.args.path, 'src/a.ts');
});

test('non-string and traversal inputs fail closed through the proposal validator', () => {
  for (const bad of [42, null, undefined, {}, ['a.ts'], '../secret.txt']) {
    assert.equal(read(bad).ok, false);
  }
});
