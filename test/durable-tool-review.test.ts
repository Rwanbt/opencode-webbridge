import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Plugin } from '@opencode/plugin';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import { OfflineToolPermissionReview, type ToolScope } from '../src/core/offline-tool-permission.js';

const scope: ToolScope = { sessionID: 'session_1', providerID: 'qwen',
  tabID: 'tab_1', accountRef: 'account_1', workspaceID: 'workspace_1',
  agentID: 'agent_1', worktreeRef: 'worktree_1', turnID: 'turn_1' };
const proposal = { version: 2, kind: 'tool_proposal',
  sessionID: scope.sessionID, workspaceID: scope.workspaceID, agentID: scope.agentID,
  worktreeRef: scope.worktreeRef, turnID: scope.turnID, operationID: 'op_1',
  tool: { name: 'safe_echo', arguments: { text: 'hello' } } };

type NativePermission = Pick<Plugin.Context['permission'], 'assert'>;
type Inputs = ConstructorParameters<typeof OfflineToolPermissionReview>[0];
const key = randomBytes(32).toString('hex');

function reviewer(journal: DurableRelayJournal, calls: { count: number }): OfflineToolPermissionReview {
  const host = {
    getScope: () => scope, authorityEpoch: () => 'rev_1',
    permission: { assert: async () => { calls.count++; } } as unknown as NativePermission,
    tools: new Map([['safe_echo', {
      action: 'safe_echo', validateArguments: () => true, resources: () => ['echo:hello'],
    }]]),
    reserveOperation: (operationID: string) => journal.prepare(operationID),
  };
  return new OfflineToolPermissionReview(host as Inputs);
}

test('real signed journal commits tool review identity before prompting and denies replay after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-tool-review-'));
  try {
    const dir = join(root, 'journal');
    const witness = join(root, 'witness');
    const binding = { sessionID: scope.sessionID, providerID: scope.providerID,
      tabID: scope.tabID, accountRef: scope.accountRef };
    const first = DurableRelayJournal.open(dir, binding, key, witness);
    const calls = { count: 0 };
    try {
      assert.deepEqual(await reviewer(first, calls).review(proposal),
        { status: 'checked-only', operationID: 'op_1' });
      assert.deepEqual(first.status(), [{ turnID: 'op_1', phase: 'prepared' }]);
      assert.equal(calls.count, 2);
    } finally { first.close(); }

    const restored = DurableRelayJournal.open(dir, binding, key, witness);
    try {
      assert.deepEqual(restored.status(), [{ turnID: 'op_1', phase: 'prepared' }]);
      const afterRestart = { count: 0 };
      await assert.rejects(reviewer(restored, afterRestart).review(proposal), /already recorded|replay/);
      await assert.rejects(reviewer(restored, afterRestart).review({ ...proposal,
        operationID: 'op_2' }), /unresolved browser effects/);
      assert.equal(afterRestart.count, 0);
    } finally { restored.close(); }

    unlinkSync(join(witness, 'witness.json'));
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, witness), /witness|rollback/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('failed durable operation reservation never reaches even the first permission prompt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-tool-lock-'));
  try {
    const binding = { sessionID: scope.sessionID, providerID: scope.providerID,
      tabID: scope.tabID, accountRef: scope.accountRef };
    const journal = DurableRelayJournal.open(join(root, 'journal'), binding, key, join(root, 'witness'));
    try {
      journal.prepare('op_1');
      const calls = { count: 0 };
      await assert.rejects(reviewer(journal, calls).review(proposal), /already recorded|replay/);
      assert.equal(calls.count, 0);
    } finally { journal.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('asynchronous journal hook is rejected before any SDK permission prompts', async () => {
  const calls = { count: 0 };
  const review = new OfflineToolPermissionReview({
    getScope: () => scope,
    authorityEpoch: () => 'rev_1',
    permission: { assert: async () => { calls.count++; } } as unknown as NativePermission,
    tools: new Map([['safe_echo', {
      action: 'safe_echo', validateArguments: () => true, resources: () => ['echo:hello'],
    }]]),
    reserveOperation: async () => {},
  } as Inputs);
  await assert.rejects(review.review(proposal), /reservation must complete synchronously/);
  assert.equal(calls.count, 0);
  await assert.rejects(review.review(proposal), /replay/);
});

test('HMAC-valid tool review journal rollback is detected by independent witness', () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-tool-rollback-'));
  const binding = { sessionID: scope.sessionID, providerID: scope.providerID,
    tabID: scope.tabID, accountRef: scope.accountRef };
  const dir = join(root, 'journal');
  const witness = join(root, 'independent-witness');
  try {
    const store = DurableRelayJournal.open(dir, binding, key, witness);
    let validOlderState: Buffer;
    try {
      store.prepare('op_1');
      validOlderState = readFileSync(join(dir, 'journal.json'));
      store.leased('op_1');
    } finally { store.close(); }
    // MAC alone accepts this snapshot; the independent witness must refuse it.
    writeFileSync(join(dir, 'journal.json'), validOlderState!);
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, witness), /witness|rollback/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('revocation inside synchronous durable reservation prevents any native consent prompt', async () => {
  let epoch = 'rev_1';
  let prompts = 0;
  const review = new OfflineToolPermissionReview({
    getScope: () => scope,
    authorityEpoch: () => epoch,
    permission: { assert: async () => { prompts++; } } as unknown as NativePermission,
    tools: new Map([['safe_echo', {
      action: 'safe_echo', validateArguments: () => true, resources: () => ['echo:hello'],
    }]]),
    reserveOperation: () => { epoch = 'rev_2'; },
  });
  await assert.rejects(review.review(proposal), /revoked/);
  assert.equal(prompts, 0, 'no consent after a synchronous authority revision');
});
