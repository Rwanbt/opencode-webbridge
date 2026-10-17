/** G145: fixture-only bridge of serialized tool intent to host-owned read-only
 * filesystem/Git and signed durable receipt. No native Core/OS authority. */
import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DurableOperationFence, type DurableOperationIdentity } from '../core/durable-operation-fence.js';
import { ToolBroker } from '../core/tool-broker.js';
import { ingestToolProposalJSON } from '../core/tool-proposal-json-ingress.js';
import type { ToolProposal, ToolScope } from '../core/tool-proposal.js';
import { createOfflineReadonlyExecutor, type OfflineReadonlyResult } from './offline-readonly-tool-executor.js';

export interface OfflineToolTurnOptions {
  readonly workspace: string;
  /** Two independently managed test directories under the OS temp root. */
  readonly journalRoot: string;
  readonly witnessRoot: string;
  readonly signingKey: string;
  /** Callbacks are injected by the test HOST, never extracted from JSON or DOM. */
  readonly authorize: (proposal: ToolProposal) => Promise<boolean>;
  readonly approve: (proposal: ToolProposal) => Promise<boolean>;
  readonly verifyReceipt: (proposal: ToolProposal, result: OfflineReadonlyResult) => Promise<boolean>;
  readonly now: () => number;
  readonly signal?: AbortSignal;
}
export type OfflineToolReceipt = Readonly<OfflineReadonlyResult & {
  operationID: string;
  proposalHash: string;
  phase: 'confirmed';
}>;
const fail = (reason: string): never => { throw new Error('G145 fixture NO-GO: ' + reason); };
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
};
/** Never permit a hostile input to select a journal outside a disposable test root. */
const root = (path: string): string => {
  if (typeof path !== 'string' || !isAbsolute(path)) return fail('journal root must be absolute');
  const canonical = realpathSync(path);
  const temp = realpathSync(tmpdir());
  if (canonical !== resolve(path) || !within(temp, canonical) ||
      !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
    return fail('journal root must be an unlinked canonical temporary test directory');
  return canonical;
};

export class OfflineToolTurnOrchestrator {
  private readonly broker = new ToolBroker();
  private readonly journal!: string;
  private readonly witness!: string;
  constructor(private readonly options: OfflineToolTurnOptions) {
    if (typeof options.authorize !== 'function' || typeof options.approve !== 'function' ||
        typeof options.verifyReceipt !== 'function' || typeof options.now !== 'function' ||
        !/^[a-f0-9]{64}$/.test(options.signingKey)) return fail('trusted fixture callbacks and key required');
    this.journal = root(options.journalRoot);
    this.witness = root(options.witnessRoot);
    if (this.journal === this.witness || within(this.journal, this.witness) ||
        within(this.witness, this.journal)) return fail('witness storage must be disjoint');
  }

  /** Each durable operation is new exactly once; crash/restart never replays. */
  async run(wire: unknown, hostScope: ToolScope): Promise<OfflineToolReceipt> {
    const admitted = ingestToolProposalJSON(wire, hostScope);
    if (!admitted.ok) return fail('serialized proposal denied: ' + admitted.reason);
    const proposal = admitted.proposal;
    // G133 returns an immutable, normalized action/args/provenance: no getters
    // or untrusted toJSON execute during this host-owned hash computation.
    const proposalHash = createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
    const stamp = this.options.now();
    const reserved = this.broker.reserve({
      proposalHash, sessionID: proposal.provenance.sessionID,
      agentID: proposal.provenance.agentID, turnID: proposal.provenance.turnID,
      workspaceID: proposal.provenance.workspaceID, now: stamp,
    });
    if (!reserved.ok || reserved.reused)
      return fail('duplicate or invalid operation reservation: no automatic retry');
    const operationID = reserved.operation.operationID;
    const identity: DurableOperationIdentity = Object.freeze({
      sessionID: proposal.provenance.sessionID, agentID: proposal.provenance.agentID,
      turnID: proposal.provenance.turnID, workspaceID: proposal.provenance.workspaceID,
      operationID, proposalHash,
    });
    // initialize refuses an existing history. Even a restarted in-memory broker
    // cannot override the durable consuming/confirmed/uncertain journal.
    const fence = DurableOperationFence.initialize(
      join(this.journal, proposalHash), join(this.witness, proposalHash),
      identity, this.options.signingKey,
    );
    let consumed = false;
    try {
      const authorize = async () => {
        if (this.options.signal?.aborted) return fail('host request interrupted');
        if (await this.options.authorize(proposal) !== true) return fail('host permission revoked');
        if (this.options.signal?.aborted) return fail('host request interrupted');
      };
      await authorize();
      if (await this.options.approve(proposal) !== true) return fail('operator did not approve fixture');
      await authorize();
      fence.consent();
      if (!this.broker.consent(operationID, this.options.now()))
        return fail('operation consent expired or invalid');
      // Persist before any filesystem/Git read or async host-owned action.
      fence.consume();
      consumed = true;
      if (!this.broker.consume(operationID)) return fail('operation already consumed');
      const executor = createOfflineReadonlyExecutor({
        workspace: this.options.workspace, authorize: this.options.authorize,
        signal: this.options.signal,
      });
      const result = await executor.execute(proposal, proposal.provenance);
      const final = await fence.confirm(async () => {
        await authorize();
        const verified = await this.options.verifyReceipt(proposal, result);
        // A revocation during the awaited host receipt verification must deny
        // disclosure even if the verifier returned a once-valid true.
        await authorize();
        return verified === true && !this.options.signal?.aborted;
      });
      if (final !== 'confirmed') {
        this.broker.uncertain(operationID);
        return fail('native receipt not confirmed: uncertain, do not replay');
      }
      if (!this.broker.executed(operationID))
        return fail('operation receipt state mismatch');
      return Object.freeze({ ...result, operationID, proposalHash, phase: 'confirmed' });
    } catch (error) {
      // Once consumed, outcome is unknown even if the read/host rejects.
      // Neither an exception nor interruption can relabel it not-applied.
      try {
        const phase = fence.status().phase;
        if (phase === 'consuming') fence.uncertain();
        else if (phase === 'reserved' || phase === 'consented') fence.cancelled();
      } catch { /* no replay: journal uncertainty is already fail-closed */ }
      if (consumed) this.broker.uncertain(operationID);
      else this.broker.fail(operationID, 'cancelled');
      throw error;
    } finally {
      fence.close();
    }
  }
}
