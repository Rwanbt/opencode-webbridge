/** G149: host-owned real filesystem/Git read during the SAME official CLI
 * model/RPC/Chromium/SSE session turn. Linux fixture, no OS trusted authority. */
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createG130ReceiptHost } from './g130-receipt-host.mjs';

const id = (sessionID) => ({
  sessionID, providerID: 'qwen', accountRef: 'g149OfflineFixture',
  tabID: 'g149LocalChromium', tabGeneration: 'g149Tab' + randomBytes(8).toString('hex'),
  connectionID: 'g149LocalHost', connectionGeneration: 'g149Conn' + randomBytes(8).toString('hex'),
}); // Deliberately NOT OS-attested; qwen label is NOT a commercial session.

export async function createG149VerticalHost({ temp, sessionID, turnID,
  authorize = async () => true, approve = async () => true,
  verifyReceipt = async () => true } = {}) {
  if (process.platform !== 'linux')
    throw new Error('G149 local filesystem fixture confined to Linux CI');
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(sessionID) ||
      !/^[a-f0-9]{32}$/.test(turnID)) throw new Error('G149 native session identity invalid');
  const load = (file) => import(pathToFileURL(
    join(process.cwd(), 'dist/src', file)).href);
  const [{ OfflineToolTurnOrchestrator }, { DurableOperationFence },
    { ingestToolProposalJSON }] = await Promise.all([
    load('testing/offline-tool-turn-orchestrator.js'),
    load('core/durable-operation-fence.js'),
    load('core/tool-proposal-json-ingress.js'),
  ]);
  const workspace = join(temp, 'g149-workspace-' + turnID);
  const journalRoot = join(temp, 'g149-journal-' + turnID);
  const witnessRoot = join(temp, 'g149-witness-' + turnID);
  await Promise.all([workspace, journalRoot, witnessRoot].map((dir) => mkdir(dir)));
  const content = 'G149_LOCAL_READ_IN_NATIVE_TURN';
  await writeFile(join(workspace, 'proof.txt'), content);
  const scope = Object.freeze({
    sessionID, agentID: 'g149Agent', turnID,
    workspaceID: 'g149Workspace', callID: 'g149Call',
  });
  const wire = JSON.stringify({ version: 1, action: 'file.read',
    args: { path: 'proof.txt' }, provenance: scope });
  const parsed = ingestToolProposalJSON(wire, scope);
  assert.equal(parsed.ok, true);
  const proposalHash = createHash('sha256').update(JSON.stringify(parsed.proposal)).digest('hex');
  const operationID = 'op-1-' + proposalHash.slice(0, 8);
  const signingKey = randomBytes(32).toString('hex');
  const tool = new OfflineToolTurnOrchestrator({
    workspace, journalRoot, witnessRoot, signingKey,
    now: () => 1000, authorize, approve, verifyReceipt,
  });
  const original = await createG130ReceiptHost({ temp,
    turnID, identity: id(sessionID) });
  let applied = false;
  let outcome;
  return {
    ...original,
    testTurnID: turnID,
    async runReadonlyTool() {
      if (applied) throw new Error('G149 attempted second tool invocation');
      applied = true;
      outcome = await tool.run(wire, scope);
      assert.equal(outcome.output, content);
      assert.equal(outcome.phase, 'confirmed');
    },
    async verifyRestored(kinds) {
      const receipt = await original.verifyRestored(kinds);
      assert.equal(applied, true, 'native RPC first frame never triggered host tool');
      assert.equal(outcome?.phase, 'confirmed');
      const persisted = DurableOperationFence.open(join(journalRoot, proposalHash),
        join(witnessRoot, proposalHash),
        { sessionID, agentID: scope.agentID, turnID, workspaceID: scope.workspaceID,
          operationID, proposalHash }, signingKey);
      try { assert.equal(persisted.status().phase, 'confirmed'); }
      finally { persisted.close(); }
      await assert.rejects(
        new OfflineToolTurnOrchestrator({
          workspace, journalRoot, witnessRoot, signingKey, now: () => 1000,
          authorize, approve, verifyReceipt,
        }).run(wire, scope), /already initialized/);
      assert.equal(await readFile(join(workspace, 'proof.txt'), 'utf8'), content);
      return { ...receipt, readonlyToolConfirmed: true, nativeSessionBound: true,
        reusedAfterRestart: false };
    },
  };
}
