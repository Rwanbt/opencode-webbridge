import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';
import { assertOpaqueID } from '../core/browser-port.js';

/** Offline limits for a future native agent orchestrator: NO tool execution. */
export type WorkerRequest = Readonly<{
  workspaceID: string;
  sessionID: string;
  parentAgentID: string;
  agentID: string;
  providerID: WebProviderID;
  accountRef: string;
  worktreePath: string;
  turnID: string;
}>;
type Active = { request: WorkerRequest; proof: string; spent: number };
const fields = ['accountRef', 'agentID', 'parentAgentID', 'providerID', 'sessionID',
  'turnID', 'workspaceID', 'worktreePath'].sort().join(',');

function verifyRequest(input: WorkerRequest, trustedRoot: string): WorkerRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
    throw new Error('invalid worker provenance');
  const props = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(props).some((key) => typeof key !== 'string' || !('value' in props[key])) ||
    Object.keys(props).sort().join(',') !== fields) throw new Error('invalid worker provenance descriptors');
  const values = Object.fromEntries(Object.entries(props).map(([key, desc]) => [key, desc.value])) as
    Record<keyof WorkerRequest, string>;
  for (const key of ['workspaceID', 'sessionID', 'parentAgentID', 'agentID', 'providerID',
    'accountRef', 'turnID'] as const) assertOpaqueID(values[key], key);
  if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === values.providerID))
    throw new Error('unknown fixture provider');
  const original = values.worktreePath;
  if (typeof original !== 'string' || !isAbsolute(original) || original.includes('\0'))
    throw new Error('invalid worker worktree location');
  const canonical = realpathSync.native(original);
  const root = realpathSync.native(trustedRoot);
  const delta = relative(root, canonical);
  if (!delta || delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta))
    throw new Error('worker worktree outside trusted root');
  return Object.freeze({ workspaceID: values.workspaceID, sessionID: values.sessionID,
    parentAgentID: values.parentAgentID, agentID: values.agentID,
    providerID: values.providerID as WebProviderID, accountRef: values.accountRef,
    worktreePath: canonical, turnID: values.turnID });
}

export class OfflineWorkerAdmission {
  private readonly active = new Map<string, Active>();
  private readonly tombstones = new Set<string>();
  constructor(private readonly root: string, private readonly maxGlobal = 4,
    private readonly maxPerAccount = 1, private readonly maxWorkUnits = 16) {
    if (![maxGlobal, maxPerAccount, maxWorkUnits].every((v) =>
      Number.isSafeInteger(v) && v >= 1 && v <= 64)) throw new Error('invalid worker limits');
    realpathSync.native(root);
  }
  private key(p: WorkerRequest) {
    return JSON.stringify([p.workspaceID, p.sessionID, p.agentID, p.turnID]);
  }
  admit(proposal: WorkerRequest): string {
    const request = verifyRequest(proposal, this.root);
    const id = this.key(request);
    if (this.tombstones.has(id) || this.active.has(id)) throw new Error('worker turn already spent');
    if (this.tombstones.size >= 512) throw new Error('worker tombstone limit reached');
    if (this.active.size >= this.maxGlobal) throw new Error('global worker limit reached');
    if ([...this.active.values()].some(({ request: x }) =>
      x.worktreePath === request.worktreePath)) throw new Error('worktree already owned');
    if ([...this.active.values()].filter(({ request: x }) =>
      x.providerID === request.providerID && x.accountRef === request.accountRef).length >= this.maxPerAccount)
      throw new Error('provider account worker limit reached');
    const proof = randomBytes(32).toString('hex');
    this.tombstones.add(id); // No release may resurrect a used turn.
    this.active.set(id, { request, proof, spent: 0 });
    return proof;
  }
  private owned(request: WorkerRequest, proof: string): Active {
    const record = this.active.get(this.key(verifyRequest(request, this.root)));
    const actual = typeof proof === 'string' ? Buffer.from(proof) : Buffer.alloc(0);
    const expected = record ? Buffer.from(record.proof) : Buffer.alloc(0);
    if (!record || actual.length !== expected.length || !timingSafeEqual(actual, expected) ||
      Object.keys(record.request).some((key) => record.request[key as keyof WorkerRequest] !==
        request[key as keyof WorkerRequest])) throw new Error('worker permission or ownership denied');
    return record;
  }
  consume(request: WorkerRequest, proof: string, units: number): number {
    const record = this.owned(request, proof);
    if (!Number.isSafeInteger(units) || units < 1 || record.spent + units > this.maxWorkUnits)
      throw new Error('worker quota exhausted');
    record.spent += units;
    return this.maxWorkUnits - record.spent;
  }
  stop(request: WorkerRequest, proof: string): void {
    this.owned(request, proof);
    this.active.delete(this.key(request));
  }
  snapshot() {
    return Object.freeze({ active: this.active.size, usedTurns: this.tombstones.size,
      maxGlobal: this.maxGlobal, maxPerAccount: this.maxPerAccount });
  }
}
