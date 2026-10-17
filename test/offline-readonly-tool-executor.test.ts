import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOfflineReadonlyExecutor } from '../src/testing/offline-readonly-tool-executor.js';

const scope = { sessionID: 'sFixture', agentID: 'aFixture', turnID: 'tFixture',
  workspaceID: 'wFixture', callID: 'cFixture' };
const raw = (action: string, args: object = {}) =>
  ({ version: 1, action, args, provenance: { ...scope } });
const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync('git', args, { cwd, shell: false, encoding: 'utf8', timeout: 3500 });
  assert.equal(result.status, 0, result.stderr);
};
async function sandbox(run: (root: string, outside: string) => Promise<void>) {
  const base = mkdtempSync(join(tmpdir(), 'webbridge-g135-'));
  const root = join(base, 'ws'); const outside = join(base, 'outside');
  try { mkdirSync(root); mkdirSync(outside); await run(root, outside); }
  finally { rmSync(base, { recursive: true, force: true }); }
}

test('REAL fixture git.status/log/diff and frozen bounded output; no git index mutation', () =>
  sandbox(async (root) => {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'hello.txt'), 'before\n');
    git(root, 'add', 'hello.txt');
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost',
      'commit', '-qm', 'fixture first');
    writeFileSync(join(root, 'hello.txt'), 'after\n');
    const { execute } = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => true });
    const original = readFileSync(join(root, '.git/index'));
    assert.match((await execute(raw('git.status'), scope)).output, /hello\.txt/);
    assert.match((await execute(raw('git.log', { limit: 1 }), scope)).output, /fixture first/);
    const diff = await execute(raw('git.diff', { path: 'hello.txt' }), scope);
    assert.match(diff.output, /\+after/);
    assert.ok(Object.isFrozen(diff));
    assert.deepEqual(readFileSync(join(root, '.git/index')), original);
    const check = await execute(raw('git.diff', { path: 'hello.txt', staged: true }), scope);
    assert.equal(check.output, '');
  }));

test('file.read opens real regular Linux inode, refuses .git, symlink and hardlink alias', () =>
  sandbox(async (root, outside) => {
    writeFileSync(join(root, 'safe.txt'), 'SAFE ONLY');
    writeFileSync(join(outside, 'secret.txt'), 'SECRET_OUTSIDE');
    const { execute } = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => true });
    if (process.platform !== 'linux') {
      await assert.rejects(execute(raw('file.read', { path: 'safe.txt' }), scope), /unsupported|NO-GO/);
      return;
    }
    assert.equal((await execute(raw('file.read', { path: 'safe.txt' }), scope)).output, 'SAFE ONLY');
    await assert.rejects(execute(raw('file.read', { path: '.git/config' }), scope));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    await assert.rejects(execute(raw('file.read', { path: 'link.txt' }), scope), /symlink|confine|alias/);
    symlinkSync(outside, join(root, 'jump'), 'dir');
    await assert.rejects(execute(raw('file.read', { path: 'jump/secret.txt' }), scope), /symlink|confine|alias/);
    linkSync(join(outside, 'secret.txt'), join(root, 'alias.txt'));
    await assert.rejects(execute(raw('file.read', { path: 'alias.txt' }), scope), /hardlink|alias/);
  }));

test('rename race, post-await revoke, abort and explicit policy denial yield no bytes', () =>
  sandbox(async (root, outside) => {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'target.txt'), 'ALLOWED_DATA');
    writeFileSync(join(outside, 'secret.txt'), 'SECRET_OUTSIDE');
    let calls = 0;
    const racing = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => {
      if (++calls === 2) {
        renameSync(join(root, 'target.txt'), join(root, 'retired.txt'));
        symlinkSync(join(outside, 'secret.txt'), join(root, 'target.txt'));
      }
      return true;
    } });
    await assert.rejects(racing.execute(raw('file.read', { path: 'target.txt' }), scope));
    assert.equal(calls, process.platform === 'linux' ? 2 : 1);
    let revocations = 0;
    const revoke = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => {
      if (++revocations === 2) throw new Error('permission revoked');
      return true;
    } });
    await assert.rejects(revoke.execute(raw('git.status'), scope), /permission revoked/);
    const denied = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => {
      throw new Error('policy denied');
    } });
    await assert.rejects(denied.execute(raw('git.log'), scope), /policy denied/);
    const implicit = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => false });
    await assert.rejects(implicit.execute(raw('git.status'), scope), /host policy denied/);
    const controller = new AbortController(); controller.abort();
    const interrupted = createOfflineReadonlyExecutor({ workspace: root,
      authorize: async () => true, signal: controller.signal });
    await assert.rejects(interrupted.execute(raw('git.status'), scope), /uncertain|aborted/i);
  }));

test('malformed provenance/unknown or mutable actions, escaped secrets and output budgets fail closed', () =>
  sandbox(async (root) => {
    git(root, 'init', '-q');
    writeFileSync(join(root, 'exposure.txt'), 'api_key=TOP_SECRET_CANNOT_LEAK');
    const { execute } = createOfflineReadonlyExecutor({ workspace: root, authorize: async () => true, maxBytes: 4096 });
    await assert.rejects(execute({ ...raw('file.read', { path: 'exposure.txt' }),
      provenance: { ...scope, sessionID: 'wrong' } }, scope), /scope|proposal/i);
    await assert.rejects(execute(raw('terminal.exec', { command: 'echo x' }), scope), /proposal|action/i);
    await assert.rejects(execute(raw('network.fetch'), scope), /proposal|action/i);
    await assert.rejects(execute(raw('file.read', { path: '../../outside' }), scope), /proposal|path/i);
    if (process.platform === 'linux') {
      await assert.rejects(execute(raw('file.read', { path: 'exposure.txt' }), scope), /secret|unsafe/i);
      writeFileSync(join(root, 'escaped.txt'), 'api\\u005fkey=ESCAPED_SECRET');
      await assert.rejects(execute(raw('file.read', { path: 'escaped.txt' }), scope), /escaped|unsafe/i);
      writeFileSync(join(root, 'oversize.txt'), 'x'.repeat(5000));
      await assert.rejects(execute(raw('file.read', { path: 'oversize.txt' }), scope), /size|budget/i);
    }
  }));
