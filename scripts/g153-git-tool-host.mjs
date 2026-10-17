/** G153: Linux ONLY real Git read actions inside official-root native model turn. */
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createG130ReceiptHost } from './g130-receipt-host.mjs';

const identity = (sessionID) => ({
  sessionID, providerID: 'qwen', accountRef: 'g153LocalGitOnly',
  tabID: 'g153LocalChrome', tabGeneration: 'g153Tab',
  connectionID: 'g153FixtureHost', connectionGeneration: 'g153Conn',
});
function git(dir, ...args) {
  const r = spawnSync('git', args, {
    cwd: dir, shell: false, windowsHide: true, encoding: 'utf8',
    timeout: 4000, env: { ...process.env,
      GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  if (r.status !== 0) throw new Error('G153 fixture Git setup failed: ' + r.status);
}
export async function createG153GitToolHost({ temp, sessionID, turnID }) {
  if (process.platform !== 'linux') throw new Error('G153 native Git read fixtures Linux-only');
  if (!/^ses_[A-Za-z0-9_-]+$/.test(sessionID) || !/^[a-f0-9]{32}$/.test(turnID))
    throw new Error('G153 official native session identity invalid');
  const load = (file) => import(pathToFileURL(
    join(process.cwd(), 'dist/src', file)).href);
  const [{ OfflineToolTurnOrchestrator }, { DurableOperationFence },
    { ingestToolProposalJSON }] = await Promise.all([
    load('testing/offline-tool-turn-orchestrator.js'),
    load('core/durable-operation-fence.js'),
    load('core/tool-proposal-json-ingress.js'),
  ]);
  const workspace = join(temp, 'g153-repo-' + turnID);
  const journalRoot = join(temp, 'g153-journal-' + turnID);
  const witnessRoot = join(temp, 'g153-witness-' + turnID);
  await Promise.all([workspace,journalRoot,witnessRoot].map((dir) => mkdir(dir)));
  git(workspace, 'init', '-q');
  await writeFile(join(workspace, 'proof.txt'), 'before\n');
  git(workspace, 'add', 'proof.txt');
  git(workspace, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost',
    'commit', '-qm', 'fixture first');
  await writeFile(join(workspace, 'proof.txt'), 'after\n');
  const indexBefore = await readFile(join(workspace, '.git', 'index'));
  const scope = Object.freeze({
    sessionID, agentID: 'g153Agent', turnID,
    workspaceID: 'g153Workspace', callID: 'g153Call',
  });
  const cases = [
    { action: 'git.status', args: {}, check: /proof\.txt/ },
    { action: 'git.diff', args: { path: 'proof.txt' }, check: /\+after/ },
    { action: 'git.log', args: { limit: 1 }, check: /fixture first/ },
  ].map((test) => {
    const wire = JSON.stringify({ version: 1, action: test.action, args: test.args,
      provenance: scope });
    const parsed = ingestToolProposalJSON(wire, scope);
    assert.equal(parsed.ok, true);
    const proposalHash = createHash('sha256')
      .update(JSON.stringify(parsed.proposal)).digest('hex');
    return { ...test, wire, proposalHash };
  });
  const signingKey = randomBytes(32).toString('hex');
  const options = { workspace, journalRoot, witnessRoot, signingKey, now: () => 1000,
    authorize: async () => true, approve: async () => true,
    verifyReceipt: async () => true };
  const executor = new OfflineToolTurnOrchestrator(options);
  const sink = await createG130ReceiptHost({
    temp, turnID, identity: identity(sessionID),
  });
  let results = [];
  let attempted = false;
  return {
    ...sink,
    async runReadonlyTool() {
      if (attempted) throw new Error('G153 duplicate native tool dispatch denied');
      attempted = true;
      for (const test of cases) {
        const result = await executor.run(test.wire, scope);
        assert.equal(result.action, test.action);
        assert.match(result.output, test.check);
        assert.equal(result.phase, 'confirmed');
        results.push(result);
      }
      assert.deepEqual(await readFile(join(workspace, '.git/index')), indexBefore,
        'read-only tools modified Git index');
      assert.equal(await readFile(join(workspace, 'proof.txt'), 'utf8'), 'after\n');
    },
    async verifyRestored(kinds) {
      const ack = await sink.verifyRestored(kinds);
      assert.equal(results.length, cases.length);
      for (let i = 0; i < cases.length; i++) {
        const test = cases[i];
        const fence = DurableOperationFence.open(
          join(journalRoot, test.proposalHash), join(witnessRoot, test.proposalHash),
          {
            sessionID, agentID: scope.agentID, turnID, workspaceID: scope.workspaceID,
            operationID: 'op-' + (i + 1) + '-' + test.proposalHash.slice(0, 8),
            proposalHash: test.proposalHash,
          }, signingKey,
        );
        try { assert.equal(fence.status().phase, 'confirmed'); }
        finally { fence.close(); }
        await assert.rejects(
          new OfflineToolTurnOrchestrator(options).run(test.wire, scope),
          /already initialized/, 'Git read attempted twice after host restart');
      }
      assert.deepEqual(await readFile(join(workspace, '.git/index')), indexBefore);
      return { ...ack, readonlyToolConfirmed: true, nativeSessionBound: true,
        gitReadOperations: cases.length, reusedAfterRestart: false };
    },
  };
}
