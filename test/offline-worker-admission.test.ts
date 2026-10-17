import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfflineWorkerAdmission, type WorkerRequest } from '../src/testing/offline-worker-admission.js';

function fixture(fn: (data: { root: string; a: WorkerRequest; b: WorkerRequest }) => void) {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-worker-'));
  try {
    mkdirSync(join(root, 'one')); mkdirSync(join(root, 'two'));
    const a: WorkerRequest = { workspaceID: 'wrk_one', sessionID: 'ses_one', parentAgentID: 'prime_one',
      agentID: 'agent_one', providerID: 'qwen', accountRef: 'account_one',
      worktreePath: join(root, 'one'), turnID: 'turn_one' };
    const b: WorkerRequest = { ...a, agentID: 'agent_two', providerID: 'gemini',
      accountRef: 'account_two', worktreePath: join(root, 'two'), turnID: 'turn_two' };
    fn({ root, a, b });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('distinct agent ownership and credentials prevent cross-worker interruption or budget theft', () => fixture(({ root, a, b }) => {
  const orchestrator = new OfflineWorkerAdmission(root, 2, 1, 3);
  const tokenA = orchestrator.admit(a);
  const tokenB = orchestrator.admit(b);
  assert.equal(orchestrator.snapshot().active, 2);
  assert.throws(() => orchestrator.stop(a, tokenB), /ownership denied/);
  assert.throws(() => orchestrator.consume(a, tokenB, 1), /ownership denied/);
  assert.throws(() => orchestrator.consume({ ...a, sessionID: 'other' }, tokenA, 1), /ownership denied/);
  assert.throws(() => orchestrator.consume({ ...a, parentAgentID: 'other' }, tokenA, 1), /ownership denied/);
  assert.equal(orchestrator.consume(a, tokenA, 2), 1);
  assert.throws(() => orchestrator.consume(a, tokenA, 2), /quota/);
  assert.equal(orchestrator.consume(b, tokenB, 1), 2);
  orchestrator.stop(a, tokenA);
  assert.equal(orchestrator.snapshot().active, 1);
  assert.throws(() => orchestrator.admit(a), /already spent/);
  orchestrator.stop(b, tokenB);
  assert.equal(orchestrator.snapshot().active, 0);
}));

test('provider/account quotas and global concurrency limits do not leak other worktree slots', () => fixture(({ root, a, b }) => {
  const perAccount = new OfflineWorkerAdmission(root, 4, 1);
  const token = perAccount.admit(a);
  assert.throws(() => perAccount.admit({ ...b, providerID: a.providerID, accountRef: a.accountRef }), /provider account/);
  const tokenB = perAccount.admit(b);
  perAccount.stop(a, token);
  perAccount.stop(b, tokenB);
  const global = new OfflineWorkerAdmission(root, 1, 2);
  global.admit(a);
  assert.throws(() => global.admit(b), /global worker/);
}));

test('hostile request descriptors, hidden credential fields and untrusted filesystem provenance are denied', () => fixture(({ root, a, b }) => {
  const orchestrator = new OfflineWorkerAdmission(root);
  let getters = 0;
  const attack = Object.defineProperty({ ...a }, 'providerID', {
    enumerable: true, get() { getters++; return 'qwen'; },
  });
  assert.throws(() => orchestrator.admit(attack), /descriptors/);
  assert.equal(getters, 0);
  assert.throws(() => orchestrator.admit({ ...a, password: 'not-for-logs' } as WorkerRequest), /descriptors/);
  assert.throws(() => orchestrator.admit({ ...a, worktreePath: root }), /outside trusted root/);
  assert.throws(() => orchestrator.admit({ ...a, worktreePath: join(root, '..') }), /outside trusted root/);
  assert.throws(() => orchestrator.admit({ ...a, turnID: '../escape' }), /invalid opaque/);
  const own = orchestrator.admit(a);
  assert.throws(() => orchestrator.admit({ ...b, worktreePath: a.worktreePath }), /worktree already owned/);
  orchestrator.stop(a, own);
}));
