import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableOperationFence } from '../src/core/durable-operation-fence.js';
import { ingestToolProposalJSON } from '../src/core/tool-proposal-json-ingress.js';
import { OfflineToolTurnOrchestrator, type OfflineToolTurnOptions } from '../src/testing/offline-tool-turn-orchestrator.js';

const scope = { sessionID: 'session1', agentID: 'agent1', turnID: 'turn1',
  workspaceID: 'workspace1', callID: 'call1' };
const key = randomBytes(32).toString('hex');
const wire = (action: string, args: object = {}) =>
  JSON.stringify({ version: 1, action, args, provenance: { ...scope } });
async function sandbox(run: (options: OfflineToolTurnOptions) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-g145-'));
  const workspace = join(root, 'workspace'), journalRoot = join(root, 'ledger'),
    witnessRoot = join(root, 'witness');
  for (const dir of [workspace,journalRoot,witnessRoot]) mkdirSync(dir);
  try {
    await run({
      workspace, journalRoot, witnessRoot, signingKey: key, now: () => 1000,
      approve: async () => true, authorize: async () => true,
      verifyReceipt: async () => true,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
function identityFor(wireText: string) {
  const admitted = ingestToolProposalJSON(wireText, scope);
  assert.equal(admitted.ok, true);
  if (!admitted.ok) throw new Error('test fixture invalid');
  const digest = createHash('sha256').update(JSON.stringify(admitted.proposal)).digest('hex');
  return { ...scope, operationID: 'op-1-' + digest.slice(0, 8),
    proposalHash: digest };
}
function persisted(options: OfflineToolTurnOptions, text: string) {
  const id = identityFor(text);
  const ledger = DurableOperationFence.open(
    join(options.journalRoot, id.proposalHash),
    join(options.witnessRoot, id.proposalHash), {
      sessionID: id.sessionID, agentID: id.agentID, turnID: id.turnID,
      workspaceID: id.workspaceID, operationID: id.operationID, proposalHash: id.proposalHash,
    }, options.signingKey);
  try { return ledger.status(); } finally { ledger.close(); }
}

test('real local file.read is held until durable host confirmation, survives restart without replay',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'PUBLIC_LOCAL_ONLY');
    const text = wire('file.read', { path: 'public.txt' });
    let authorizations = 0, confirmations = 0;
    const host = new OfflineToolTurnOrchestrator({
      ...options, authorize: async () => { authorizations++; return true; },
      verifyReceipt: async () => { confirmations++; return true; },
    });
    const result = await host.run(text, scope);
    assert.equal(result.output, 'PUBLIC_LOCAL_ONLY');
    assert.equal(result.bytes, 17);
    assert.equal(result.action, 'file.read');
    assert.equal(result.phase, 'confirmed');
    assert.ok(Object.isFrozen(result));
    assert.ok(authorizations >= 5);
    assert.equal(confirmations, 1);
    assert.equal(persisted(options, text).phase, 'confirmed');
    await assert.rejects(host.run(text, scope), /duplicate/);
    const afterRestart = new OfflineToolTurnOrchestrator(options);
    await assert.rejects(afterRestart.run(text, scope), /already initialized/);
    assert.equal(confirmations, 1);
    assert.doesNotMatch(readFileSync(join(options.journalRoot, result.proposalHash,
      'operation.json'), 'utf8'), /PUBLIC_LOCAL_ONLY|session1/);
  }));

test('rejected host confirmation is uncertain and cannot reveal data or replay',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'REDACTED_NEVER_RELEASED');
    const text = wire('file.read', { path: 'public.txt' });
    const host = new OfflineToolTurnOrchestrator({
      ...options, verifyReceipt: async () => false,
    });
    await assert.rejects(host.run(text, scope), /uncertain/);
    assert.equal(persisted(options, text).phase, 'uncertain');
    await assert.rejects(new OfflineToolTurnOrchestrator(options).run(text, scope),
      /already initialized/);
  }));

test('revocation during awaited read denies disclosure and tombstones uncertain',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'REVOKED_DATA');
    const text = wire('file.read', { path: 'public.txt' });
    let checks = 0, delivered = 0;
    const host = new OfflineToolTurnOrchestrator({
      ...options,
      authorize: async () => ++checks < 4,
      verifyReceipt: async () => { delivered++; return true; },
    });
    await assert.rejects(host.run(text, scope), /revoked|policy/);
    assert.equal(delivered, 0);
    assert.equal(persisted(options, text).phase, 'uncertain');
  }));

test('concurrent duplicate proposal cannot receive two approvals or execute two reads',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'PUBLIC_ONCE');
    const text = wire('file.read', { path: 'public.txt' });
    let approveCalls = 0, authorizeCalls = 0;
    let releaseApproval!: () => void;
    const delayed = new Promise<void>((done) => { releaseApproval = done; });
    const host = new OfflineToolTurnOrchestrator({
      ...options,
      authorize: async () => { authorizeCalls++; return true; },
      approve: async () => { approveCalls++; await delayed; return true; },
    });
    const first = host.run(text, scope);
    await new Promise<void>((done) => setImmediate(done));
    const second = host.run(text, scope);
    await assert.rejects(second, /duplicate/);
    releaseApproval();
    assert.equal((await first).output, 'PUBLIC_ONCE');
    assert.equal(approveCalls, 1);
    assert.ok(authorizeCalls >= 5);
    assert.equal(persisted(options, text).phase, 'confirmed');
  }));

test('abort while awaiting operator approval writes cancelled, no file operation',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'PUBLIC');
    const text = wire('file.read', { path: 'public.txt' });
    const ctrl = new AbortController();
    const host = new OfflineToolTurnOrchestrator({
      ...options, signal: ctrl.signal,
      approve: async () => { ctrl.abort(); return true; },
    });
    await assert.rejects(host.run(text, scope), /interrupted/);
    assert.equal(persisted(options, text).phase, 'cancelled');
  }));

test('strict web JSON ingress denies arbitrary JS, mutable actions and forged native scope before consent',
  () => sandbox(async (options) => {
    let consent = 0, reads = 0;
    const host = new OfflineToolTurnOrchestrator({
      ...options, approve: async () => { consent++; return true; },
    });
    const getter = { get action() { reads++; return 'file.read'; } };
    for (const invalid of [
      getter,
      wire('terminal.exec', { command: 'whoami' }),
      '{"version":1,"version":1,"action":"file.read","args":{"path":"x"},"provenance":{}}',
      JSON.stringify({ version: 1, action: 'file.read', args: { path: 'x' },
        provenance: { ...scope, sessionID: 'forged' } }),
    ]) await assert.rejects(host.run(invalid, scope), /serialized proposal denied/);
    assert.equal(consent, 0);
    assert.equal(reads, 0);
  }));

test('journal directories outside independent canonical temporary roots are denied', () =>
  sandbox(async (options) => {
    assert.throws(() => new OfflineToolTurnOrchestrator({
      ...options, journalRoot: process.cwd(),
    }), /temporary|journal/);
    assert.throws(() => new OfflineToolTurnOrchestrator({
      ...options, witnessRoot: options.journalRoot,
    }), /disjoint/);
  }));

test('Windows file.read remains NO-GO and persisted outcome is uncertain',
  { skip: process.platform === 'linux' }, () => sandbox(async (options) => {
    writeFileSync(join(options.workspace, 'public.txt'), 'PUBLIC');
    const text = wire('file.read', { path: 'public.txt' });
    const host = new OfflineToolTurnOrchestrator(options);
    await assert.rejects(host.run(text, scope), /unsupported|NO-GO/);
    assert.equal(persisted(options, text).phase, 'uncertain');
  }));

test('real local Git diff returns bounded read-only content only after approval',
  { skip: process.platform !== 'linux' }, () => sandbox(async (options) => {
    const git = (...args: string[]) => {
      const r = spawnSync('git', args, { cwd: options.workspace, shell: false,
        timeout: 4000, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    };
    git('init', '-q');
    writeFileSync(join(options.workspace, 'note.txt'), 'before\n');
    git('add', 'note.txt');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost',
      'commit', '-qm', 'fixture');
    writeFileSync(join(options.workspace, 'note.txt'), 'after\n');
    const text = wire('git.diff', { path: 'note.txt' });
    const result = await new OfflineToolTurnOrchestrator(options).run(text, scope);
    assert.match(result.output, /\+after/);
    assert.equal(result.action, 'git.diff');
    assert.equal(persisted(options, text).phase, 'confirmed');
  }));
