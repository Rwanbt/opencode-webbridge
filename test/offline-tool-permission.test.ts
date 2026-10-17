import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Plugin } from '@opencode/plugin';
import { OfflineToolPermissionReview, parseOfflineToolProposal, type ToolScope } from '../src/core/offline-tool-permission.js';

const scope: ToolScope = {
  sessionID: 'session_1', workspaceID: 'workspace_1', agentID: 'agent_1',
  worktreeRef: 'worktree_1', turnID: 'turn_1',
  providerID: 'qwen', tabID: 'tab_1', accountRef: 'account_1',
};
const proposal = {
  version: 2, kind: 'tool_proposal', sessionID: 'session_1',
  workspaceID: 'workspace_1', agentID: 'agent_1', worktreeRef: 'worktree_1',
  turnID: 'turn_1', operationID: 'op_1',
  tool: { name: 'safe_echo', arguments: { text: 'hello' } },
};
type Permission = Pick<Plugin.Context['permission'], 'assert'>;

function harness(native: (input: { sessionID: string; action: string; resources: readonly string[] }) => Promise<void>) {
  let current = { ...scope };
  let epoch = 'rev_1';
  let executions = 0;
  const tools = new Map([['safe_echo', {
    action: 'safe_echo',
    validateArguments: (args: Readonly<Record<string, unknown>>) =>
      Object.keys(args).length === 1 && typeof args.text === 'string',
    resources: (args: Readonly<Record<string, unknown>>) => [`echo:${String(args.text)}`],
  }]]);
  const review = new OfflineToolPermissionReview({
    getScope: () => current, authorityEpoch: () => epoch,
    permission: { assert: native } as unknown as Permission, tools,
  });
  return {
    review, tools,
    replace: (field: keyof ToolScope) => { current = { ...current, [field]: 'changed' }; },
    revoke: () => { epoch = 'rev_2'; },
    executions: () => executions, // no execution adapter is passed to the review
  };
}

test('untrusted web content requires exact proposal v2 and never executes getters', () => {
  const bad: unknown[] = [
    'run bash; git reset --hard',
    '~~~json\n' + JSON.stringify(proposal),
    { ...proposal, version: 1 },
    { ...proposal, version: 1, workspaceID: undefined },
    { ...proposal, worktreeRef: 'foreign' },
    { ...proposal, workspaceID: 'foreign' },
    { ...proposal, sessionID: 'foreign' },
    { ...proposal, agentID: 'foreign' },
    { ...proposal, turnID: 'previous' },
    { ...proposal, operationID: 'invalid/id' },
    { ...proposal, tool: { name: 'bash', arguments: {}, permission: 'allow' } },
    { ...proposal, tool: { name: 'safe_echo', arguments: { text: 'ok', constructor: {} } } },
    { ...proposal, tool: { name: 'safe_echo', arguments: { text: 'x'.repeat(5000) } } },
    { ...proposal, tool: { name: 'safe_echo', arguments: { text: Infinity } } },
    { ...proposal, tool: { name: 'safe_echo', arguments: { text: [, 'sparse'] } } },
    { ...proposal, [Symbol('symbol')]: 'hidden' },
  ];
  const poisoned = JSON.parse('{"version":2,"kind":"tool_proposal","sessionID":"session_1","workspaceID":"workspace_1","agentID":"agent_1","worktreeRef":"worktree_1","turnID":"turn_1","operationID":"op_1","tool":{"name":"safe_echo","arguments":{"__proto__":{"isAdmin":true}}}}');
  bad.push(poisoned);
  let getters = 0;
  bad.push({ ...proposal, get sessionID() { getters++; return 'session_1'; } });
  bad.push({ ...proposal, tool: { name: 'safe_echo', arguments: { get text() { getters++; return 'ok'; } } } });
  bad.push({ ...proposal, tool: { name: 'safe_echo', arguments: { text: new Date() } } });
  bad.push({ ...proposal, tool: { name: 'safe_echo', arguments: Object.create(null) } });
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  bad.push({ ...proposal, tool: { name: 'safe_echo', arguments: cyclic } });
  const exoticArray = new (class extends Array<string> { toJSON() { getters++; return ['unsafe']; } })();
  bad.push({ ...proposal, tool: { name: 'safe_echo', arguments: { list: exoticArray } } });
  for (const attempt of bad) assert.throws(() => parseOfflineToolProposal(attempt, scope));
  assert.equal(getters, 0);
  assert.deepEqual(parseOfflineToolProposal(proposal, scope), proposal);
});

test('native SDK assert receives exact current session/action/resources, without any executor', async () => {
  const calls: Array<{ sessionID: string; action: string; resources: readonly string[] }> = [];
  const h = harness(async (input) => { calls.push(input); });
  assert.deepEqual(await h.review.review(proposal), { status: 'checked-only', operationID: 'op_1' });
  assert.deepEqual(calls, [
    { sessionID: 'session_1', action: 'safe_echo', resources: ['echo:hello'] },
    { sessionID: 'session_1', action: 'safe_echo', resources: ['echo:hello'] },
  ]);
  assert.equal('execute' in h.review, false);
  assert.equal(h.executions(), 0);
});

test('schema, registry, resource mapping and native denial reject without dispatch', async () => {
  let asked = 0;
  const h = harness(async () => { asked++; throw new Error('native permission denied'); });
  await assert.rejects(h.review.review({ ...proposal, tool: { name: 'terminal', arguments: {} } }), /unknown/);
  await assert.rejects(h.review.review({ ...proposal, tool: { name: 'safe_echo', arguments: { text: 1 } } }), /schema/);
  assert.equal(asked, 0);
  h.tools.get('safe_echo')!.resources = () => ['*'];
  await assert.rejects(h.review.review(proposal), /mapping/);
  assert.equal(asked, 0);
  h.tools.get('safe_echo')!.resources = () => ['echo:hello'];
  await assert.rejects(h.review.review(proposal), /permission denied/);
  assert.equal(asked, 1);
  assert.equal(h.executions(), 0);
});

test('every session/workspace/agent/worktree/turn/browser identity change during await rejects', async () => {
  for (const field of ['sessionID', 'workspaceID', 'agentID', 'worktreeRef',
    'turnID', 'providerID', 'tabID', 'accountRef'] as const) {
    let entered!: () => void;
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let calls = 0;
    const h = harness(async () => { calls++; entered(); await pending; });
    const reviewing = h.review.review(proposal);
    await started;
    h.replace(field);
    resume();
    await assert.rejects(reviewing, /revoked/, field);
    assert.equal(calls, 1, field);
  }
});

test('revocation while native permission prompts are pending cannot return a checked receipt', async () => {
  for (const revokeOn of [1, 2]) {
    let entered!: () => void;
    let resume!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    let calls = 0;
    const h = harness(async () => { if (++calls === revokeOn) { entered(); await pending; } });
    const reviewing = h.review.review(proposal);
    await started;
    h.revoke();
    resume();
    await assert.rejects(reviewing, /revoked/);
    assert.equal(calls, revokeOn);
  }
});

test('untrusted mutation cannot retarget native bash permission while user confirmation is pending', async () => {
  const raw = structuredClone(proposal);
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { resume = resolve; });
  const seen: string[] = [];
  const h = harness(async (input) => {
    seen.push(`${input.sessionID}:${input.action}:${input.resources.join(',')}`);
    if (seen.length === 1) { entered(); await pending; }
  });
  const tool = h.tools.get('safe_echo')!;
  tool.action = 'bash'; // native-owned action and exact resource, never authored by the page
  tool.resources = () => ['echo hello'];
  const checking = h.review.review(raw);
  await waiting;
  raw.sessionID = 'victim_session';
  raw.tool.arguments.text = 'dangerous new command';
  resume();
  assert.deepEqual(await checking, { status: 'checked-only', operationID: 'op_1' });
  assert.deepEqual(seen, ['session_1:bash:echo hello', 'session_1:bash:echo hello']);
  assert.equal(h.executions(), 0);
});
