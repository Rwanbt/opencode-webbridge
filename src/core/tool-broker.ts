/**
 * Durable reservation of a tool operation before permission prompting.
 *
 * A tool proposal is reserved (operationID issued) BEFORE asking the user.
 * Replaying the same proposal reuses the reservation; a new proposal gets a
 * new ID. Reservation alone is NOT execution authorization.
 */

export type OperationStatus = 'reserved' | 'consented' | 'consuming' | 'executed' | 'failed' | 'cancelled' | 'uncertain';

export interface Operation {
  readonly operationID: string;
  readonly proposalHash: string;
  readonly sessionID: string;
  readonly agentID: string;
  readonly turnID: string;
  readonly workspaceID: string;
  readonly status: OperationStatus;
  readonly createdAt: number;
}

export type ReserveResult =
  | { readonly ok: true; readonly operation: Operation; readonly reused: boolean }
  | { readonly ok: false; readonly reason: 'invalid-input' | 'capacity' | 'scope-conflict' };

export class ToolBroker {
  private readonly ops = new Map<string, Operation>(); // operationID -> op
  private readonly byHash = new Map<string, string>(); // proposalHash -> operationID
  private counter = 0;

  constructor(private readonly capacity = 256) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000)
      throw new Error('invalid tool broker capacity');
  }

  /** Reserve an operation for a proposal. Reuses an existing reservation if the
   *  same proposal hash was already reserved (idempotent reservation). */
  reserve(input: {
    proposalHash: string; sessionID: string; agentID: string; turnID: string; workspaceID: string; now: number;
  }): ReserveResult {
    // Operation reservation is still not authorization. Snapshot hostile caller
    // data before using it; never invoke a getter or toJSON on proposal output.
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).sort().join(',') !==
          'agentID,now,proposalHash,sessionID,turnID,workspaceID') {
      return { ok: false, reason: 'invalid-input' };
    }
    const data: Record<string, unknown> = {};
    for (const key of ['proposalHash', 'sessionID', 'agentID', 'turnID', 'workspaceID', 'now']) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !('value' in descriptor)) return { ok: false, reason: 'invalid-input' };
      data[key] = descriptor.value;
    }
    const { proposalHash, sessionID, agentID, turnID, workspaceID, now } = data as typeof input;
    if (typeof proposalHash !== 'string' || proposalHash.length < 8 || proposalHash.length > 256) {
      return { ok: false, reason: 'invalid-input' };
    }
    for (const v of [sessionID, agentID, turnID, workspaceID]) {
      if (typeof v !== 'string' || v.length === 0 || v.length > 128) return { ok: false, reason: 'invalid-input' };
    }
    if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: 'invalid-input' };

    const existingID = this.byHash.get(proposalHash);
    if (existingID) {
      const existing = this.ops.get(existingID);
      if (existing) {
        // A reservation is bound to its exact scope. The same proposal hash
        // presented by a different session/agent/turn/workspace is a
        // cross-scope confusion attempt and must fail closed, never silently
        // hand another session's reservation to this caller.
        if (existing.sessionID !== sessionID || existing.agentID !== agentID ||
          existing.turnID !== turnID || existing.workspaceID !== workspaceID) {
          return { ok: false, reason: 'scope-conflict' };
        }
        return { ok: true, operation: existing, reused: true };
      }
    }
    if (this.ops.size >= this.capacity) return { ok: false, reason: 'capacity' };

    this.counter += 1;
    const operationID = `op-${this.counter}-${proposalHash.slice(0, 8)}`;
    const op: Operation = Object.freeze({
      operationID, proposalHash, sessionID, agentID, turnID, workspaceID,
      status: 'reserved', createdAt: now,
    }) as Operation;
    this.ops.set(operationID, op);
    this.byHash.set(proposalHash, operationID);
    return { ok: true, operation: op, reused: false };
  }

  get(operationID: string): Operation | undefined {
    return this.ops.get(operationID);
  }

  /** Mark an operation as consented (user approved). Does NOT execute. */
  consent(operationID: string, now: number): Operation | null {
    const op = this.ops.get(operationID);
    if (!op || op.status !== 'reserved' || !Number.isSafeInteger(now) || now < op.createdAt) return null;
    const next: Operation = Object.freeze({ ...op, status: 'consented' });
    this.ops.set(operationID, next);
    return next;
  }

  /** Irreversibly claim before executing an effect; concurrent callers cannot run twice. */
  consume(operationID: string): Operation | null {
    const op = this.ops.get(operationID);
    if (!op || op.status !== 'consented') return null;
    const next: Operation = Object.freeze({ ...op, status: 'consuming' });
    this.ops.set(operationID, next);
    return next;
  }

  /** Mark executed only after a previously consumed effect was verified. */
  executed(operationID: string): Operation | null {
    const op = this.ops.get(operationID);
    if (!op || op.status !== 'consuming') return null;
    const next: Operation = Object.freeze({ ...op, status: 'executed' });
    this.ops.set(operationID, next);
    return next;
  }

  /**
   * Mark an operation UNCERTAIN after an execution attempt whose outcome
   * cannot be proven (executor failure, lost/revoked authority after the
   * effect may have run). Terminal: it can never be relabelled as applied or
   * not-applied and can never be auto-retried; reconciliation decides.
   */
  uncertain(operationID: string): Operation | null {
    const op = this.ops.get(operationID);
    if (!op || op.status !== 'consuming') return null;
    const next: Operation = Object.freeze({ ...op, status: 'uncertain' });
    this.ops.set(operationID, next);
    return next;
  }

  /** Mark failed/cancelled. */
  fail(operationID: string, status: 'failed' | 'cancelled'): Operation | null {
    const op = this.ops.get(operationID);
    if (!op) return null;
    if (op.status !== 'reserved' && op.status !== 'consented') return null; // consuming and terminal never relabel
    const next: Operation = Object.freeze({ ...op, status });
    this.ops.set(operationID, next);
    return next;
  }

  size(): number { return this.ops.size; }
}
