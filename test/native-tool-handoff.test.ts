import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToolProposal, NativeToolHandoff } from '../src/core/native-tool-handoff.js';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import type { TabClaim } from '../src/core/browser-port.js';

const owner: TabClaim = { sessionID: 'sess-1', tabID: 'tab-1', providerID: 'qwen', accountRef: 'acct-1' };
const scope = { ...owner, agentID: 'agent-1', worktreeRef: 'worktree-A', turnID: 'turn-1' };
const sample = { version: 1, kind: 'tool_proposal', sessionID: 'sess-1', agentID: 'agent-1',
  worktreeRef: 'worktree-A', turnID: 'turn-1', operationID: 'op-1',
  tool: { name: 'safe_echo', arguments: { text: 'check' } } };

function harness(fn: (journal: DurableRelayJournal, path: string, key: string) => Promise<void>): Promise<void> {
  const path = mkdtempSync(join(tmpdir(), 'webbridge-tools-'));
  const key = randomBytes(32).toString('hex');
  const journal = DurableRelayJournal.open(path, owner, key);
  return fn(journal, path, key).finally(() => { journal.close(); rmSync(path, { force: true, recursive: true }); });
}

test('web text is NEVER parsed as a tool call; JSON schema and session isolation enforced', () => {
  assert.throws(() => parseToolProposal('run bash rm -rf .', scope), /structured/);
  assert.throws(() => parseToolProposal('```json\n'+JSON.stringify(sample)+'\n```', scope), /structured/);
  assert.throws(() => parseToolProposal({ ...sample, sessionID: 'victim' }, scope), /binding/);
  assert.throws(() => parseToolProposal({ ...sample, agentID: 'victim' }, scope), /binding/);
  assert.throws(() => parseToolProposal({ ...sample, worktreeRef: 'victim' }, scope), /binding/);
  assert.throws(() => parseToolProposal({ ...sample, turnID: 'previous-turn' }, scope), /binding/);
  assert.throws(() => parseToolProposal({ ...sample, tool: { name: 'bash', arguments: {} } }, scope,
    new Set(['safe_echo'])), /not registered/);
  assert.throws(() => parseToolProposal({ ...sample, secret: 'bearer' }, scope), /fields/);
  assert.throws(() => parseToolProposal({ ...sample, tool: { name: 'safe_echo', arguments: { __proto__: null, nested: Object.create(null) } } }, scope), /plain JSON/);
  assert.throws(() => parseToolProposal({ ...sample, tool: { name: 'safe_echo', arguments: {
    get text() { throw new Error('getter must not run'); },
  } } }, scope), /plain JSON/);
  const poisoned = JSON.parse('{"version":1,"kind":"tool_proposal","sessionID":"sess-1","agentID":"agent-1","worktreeRef":"worktree-A","turnID":"turn-1","operationID":"op-1","tool":{"name":"safe_echo","arguments":{"__proto__":{"admin":true}}}}');
  assert.throws(() => parseToolProposal(poisoned, scope), /forbidden fields/);
  assert.deepEqual(parseToolProposal(sample, scope, new Set(['safe_echo'])).tool, sample.tool);
});

test('tool dispatch requires explicit permission and never silently retries rejected or uncertain effects', async () => {
  await harness(async (journal, path, key) => {
    const sends: string[] = [];
    const approvals: string[] = [];
    const gate = new NativeToolHandoff(scope, journal, new Set(['safe_echo']),
      (toolName, args) => toolName === 'safe_echo' && typeof args.text === 'string');
    const denied = await gate.dispatch(sample, async () => false, async () => { sends.push('bad'); return 'x'; });
    assert.equal(denied.status, 'denied');
    assert.equal(sends.length, 0);
    await assert.rejects(gate.dispatch(sample, async () => true, async () => 'bad'), /already recorded/);
    const different = { ...sample, operationID: 'op-2' };
    const result = await gate.dispatch(different, async (request) => {
      approvals.push(request.operationID); return true;
    }, async (request) => { sends.push(request.operationID); return 'done'; });
    assert.equal(result.status, 'completed');
    assert.equal(result.value, 'done');
    assert.deepEqual(approvals, ['op-2']);
    assert.equal(sends.join(','), 'op-2');
    await assert.rejects(gate.dispatch(different, async () => true, async () => 'double'), /already recorded/);
    const uncertain = { ...sample, operationID: 'op-3' };
    await assert.rejects(gate.dispatch(uncertain, async () => true, async () => {
      sends.push('op-3'); throw new Error('driver transport dropped after effect');
    }), /uncertain/);
    assert.equal(sends.join(','), 'op-2,op-3');
    await assert.rejects(gate.dispatch({ ...sample, operationID: 'op-4' }, async () => true,
      async () => 'no'), /unresolved/);
    assert.ok(journal.status().some((event) => event.phase === 'leased'));
    void path; void key;
  });
});

test('native schema, denied scope, invalid arguments and poisoned JSON never reach callback', async () => {
  await harness(async (journal) => {
    const gate = new NativeToolHandoff(scope, journal, new Set(['safe_echo']),
      (_name, args) => typeof args.text === 'string' && Object.keys(args).length === 1);
    let auth = 0;
    let executed = 0;
    const approve = async () => { auth++; return true; };
    const run = async () => { executed++; return true; };
    await assert.rejects(gate.dispatch({ ...sample, tool: { name: 'safe_echo', arguments: { text: 1 } } }, approve, run), /arguments/);
    await assert.rejects(gate.dispatch({ ...sample, tool: { name: 'unknown', arguments: { text: 'x' } } }, approve, run), /not registered/);
    await assert.rejects(gate.dispatch({ ...sample, worktreeRef: 'elsewhere' }, approve, run), /binding/);
    const cyc: Record<string, unknown> = {}; cyc.self = cyc;
    await assert.rejects(gate.dispatch({ ...sample, tool: { name: 'safe_echo', arguments: cyc } }, approve, run), /plain JSON/);
    assert.equal(auth, 0);
    assert.equal(executed, 0);
  });
});

test('uncertain tool execution stays blocked across a process restart and cannot acquire permission twice', async () => {
  const path = mkdtempSync(join(tmpdir(), 'webbridge-tool-restart-'));
  const key = randomBytes(32).toString('hex');
  const first = DurableRelayJournal.open(path, owner, key);
  const gate1 = new NativeToolHandoff(scope, first, new Set(['safe_echo']), () => true);
  let effects = 0;
  try {
    await assert.rejects(gate1.dispatch(sample, async () => true, async () => {
      effects++; throw new Error('effect succeeded but reply lost');
    }), /uncertain/);
  } finally { first.close(); }
  const second = DurableRelayJournal.open(path, owner, key);
  try {
    const gate2 = new NativeToolHandoff(scope, second, new Set(['safe_echo']), () => true);
    let reapprovals = 0;
    await assert.rejects(gate2.dispatch(sample, async () => { reapprovals++; return true; }, async () => {
      effects++; return 'oops';
    }), /already recorded/);
    assert.equal(effects, 1);
    assert.equal(reapprovals, 0);
  } finally { second.close(); rmSync(path, { force: true, recursive: true }); }
});

test('authorization cannot be swapped to a different tool or argument across async grant', async () => {
  await harness(async (journal) => {
    const original = structuredClone(sample);
    const gate = new NativeToolHandoff(scope, journal, new Set(['safe_echo']),
      (name, args) => name === 'safe_echo' && args.text === 'check');
    let invoked = 0;
    const response = await gate.dispatch(original, async (request) => {
      assert.equal(request.tool.name, 'safe_echo');
      original.tool.name = 'bash';
      original.tool.arguments.text = 'run arbitrary command';
      return true;
    }, async (request) => {
      invoked++;
      assert.equal(request.tool.name, 'safe_echo');
      assert.deepEqual(request.tool.arguments, { text: 'check' });
      assert.equal(Object.isFrozen(request.tool.arguments), true);
      assert.equal(Object.isFrozen(request.tool), true);
      return 'done';
    });
    assert.equal(response.status, 'completed');
    assert.equal(invoked, 1);
  });
});

test('top-level getter and concealed fields cannot become an authorized tool request', () => {
  const lazy = Object.defineProperty({ ...sample }, 'operationID', {
    enumerable: true, get() { throw new Error('untrusted getter executed'); },
  });
  assert.throws(() => parseToolProposal(lazy, scope), /structured|plain|fields/);
  const hidden = Object.defineProperty({ ...sample }, 'secret', {
    enumerable: false, value: 'hidden credential',
  });
  assert.throws(() => parseToolProposal(hidden, scope), /structured|fields/);
  const symbol = { ...sample, [Symbol.for('injected')]: true };
  assert.throws(() => parseToolProposal(symbol, scope), /structured|fields/);
  const nested = { ...sample, tool: { ...sample.tool, arguments: {
    text: 'check', [Symbol.for('hidden')]: 'injected',
  } } };
  assert.throws(() => parseToolProposal(nested, scope), /plain JSON|forbidden/);
});

test('truthy or pending schema validator cannot bypass native argument approval', async () => {
  await harness(async (journal) => {
    const invalid = [Promise.resolve(false), { approved: false }, 1, 'yes'];
    let authorized = 0;
    let executed = 0;
    for (const result of invalid) {
      const gate = new NativeToolHandoff(scope, journal, new Set(['safe_echo']),
        (() => result) as unknown as (name: string, args: Readonly<Record<string, unknown>>) => boolean);
      await assert.rejects(gate.dispatch(sample, async () => { authorized++; return true; },
        async () => { executed++; return true; }), /native schema/);
    }
    assert.equal(authorized, 0);
    assert.equal(executed, 0);
    assert.deepEqual(journal.status(), [], 'invalid validator cannot allocate durable effect');
  });
});
