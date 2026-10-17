/**
 * Offline host-side journal of one reserved tool effect. It is not an OS
 * authority; before using this with real tools the host must supply real
 * permission/attestation and independent durable storage.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export type DurableOperationPhase =
  'reserved' | 'consented' | 'consuming' | 'confirmed' | 'uncertain' | 'cancelled';
export type DurableOperationIdentity = Readonly<{
  sessionID: string; agentID: string; turnID: string; workspaceID: string;
  operationID: string; proposalHash: string;
}>;
type RecordOnDisk = { version: 1; scope: string; revision: number;
  phase: DurableOperationPhase; mac: string };
type Witness = { version: 1; scope: string; revision: number;
  recordMac: string; mac: string };
const fields = ['sessionID','agentID','turnID','workspaceID','operationID','proposalHash'] as const;
const phases = new Set(['reserved','consented','consuming','confirmed','uncertain','cancelled']);
const hex64 = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const hmac = (key: Buffer, data: unknown): string =>
  createHmac('sha256', key).update(JSON.stringify(data)).digest('hex');
const same = (a: string, b: string): boolean =>
  hex64(a) && hex64(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const exact = (v: object, keys: string[]): boolean =>
  Reflect.ownKeys(v).sort().join(',') === [...keys].sort().join(',');
function scoped(key: Buffer, raw: DurableOperationIdentity): string {
  if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype ||
      !exact(raw, [...fields])) throw new Error('operation scope invalid');
  const values = fields.map((field) => {
    const d = Object.getOwnPropertyDescriptor(raw, field);
    if (!d || !('value' in d) || typeof d.value !== 'string')
      throw new Error('operation scope descriptor invalid');
    if (field === 'proposalHash' ? !hex64(d.value) : !/^[A-Za-z0-9_.:-]{1,128}$/.test(d.value))
      throw new Error('operation scope field invalid');
    return d.value as string;
  });
  return hmac(key, ['operation-v1', ...values]);
}
function save(dir: string, name: string, content: string): void {
  const tmp = join(dir, `.fence-${randomUUID()}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, join(dir, name)); }
  catch (error) { try { unlinkSync(tmp); } catch { /* best effort */ } throw error; }
  if (process.platform !== 'win32') {
    const parent = openSync(dir, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
}

export class DurableOperationFence {
  private closed = false;
  private poisoned = false;
  private constructor(private readonly dir: string, private readonly witnessDir: string,
    private readonly lockFD: number, private readonly key: Buffer,
    private readonly scope: string, private state: RecordOnDisk) {}

  static initialize(dir: string, witnessDir: string, identity: DurableOperationIdentity,
    secret: string): DurableOperationFence {
    return this.load(dir, witnessDir, identity, secret, true);
  }
  static open(dir: string, witnessDir: string, identity: DurableOperationIdentity,
    secret: string): DurableOperationFence {
    return this.load(dir, witnessDir, identity, secret, false);
  }
  private static load(dir: string, witnessDir: string, identity: DurableOperationIdentity,
    secret: string, initialize: boolean): DurableOperationFence {
    if (!hex64(secret)) throw new Error('invalid journal signing key');
    const key = Buffer.from(secret, 'hex');
    const scope = scoped(key, identity);
    if (initialize) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      mkdirSync(witnessDir, { recursive: true, mode: 0o700 });
    }
    for (const path of [dir, witnessDir])
      if (!existsSync(path) || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
        throw new Error('operation directory missing or linked');
    const root = realpathSync(dir), other = realpathSync(witnessDir);
    if (root === other || root.startsWith(other + sep) || other.startsWith(root + sep))
      throw new Error('independent operation witness directory required');
    let fd: number;
    try { fd = openSync(join(root, '.fence.lock'), 'wx', 0o600); }
    catch { throw new Error('operation journal locked: operator recovery required'); }
    try {
      const stateFile = join(root, 'operation.json');
      const witnessFile = join(other, 'operation.witness.json');
      const present = existsSync(stateFile), witnessPresent = existsSync(witnessFile);
      if (present !== witnessPresent) throw new Error('operation witness missing: no automatic replay');
      if (initialize && present) throw new Error('operation already initialized');
      if (!initialize && !present) throw new Error('operation history missing: no silent reset');
      let state: RecordOnDisk;
      if (initialize) {
        const body = [1, scope, 0, 'reserved'] as const;
        state = { version: 1, scope, revision: 0, phase: 'reserved', mac: hmac(key, body) };
      } else {
        if (!lstatSync(stateFile).isFile() || !lstatSync(witnessFile).isFile() ||
            lstatSync(stateFile).size > 2048 || lstatSync(witnessFile).size > 2048)
          throw new Error('operation record invalid');
        state = JSON.parse(readFileSync(stateFile, 'utf8')) as RecordOnDisk;
        const witness = JSON.parse(readFileSync(witnessFile, 'utf8')) as Witness;
        if (!state || !witness ||
            !exact(state, ['version','scope','revision','phase','mac']) ||
            !exact(witness, ['version','scope','revision','recordMac','mac']) ||
            state.version !== 1 || witness.version !== 1 || state.scope !== scope ||
            witness.scope !== scope || !Number.isSafeInteger(state.revision) ||
            state.revision < 0 || state.revision > 6 ||
            witness.revision !== state.revision || !phases.has(state.phase) ||
            !same(hmac(key,[1,scope,state.revision,state.phase]), state.mac) ||
            !same(witness.recordMac, state.mac) ||
            !same(hmac(key,[1,scope,state.revision,state.mac]), witness.mac))
          throw new Error('operation journal integrity, scope or rollback mismatch');
      }
      const fence = new DurableOperationFence(root, other, fd, key, scope, state);
      if (initialize) fence.write(state);
      return fence;
    } catch (error) {
      closeSync(fd); unlinkSync(join(root, '.fence.lock'));
      key.fill(0);
      throw error;
    }
  }
  private assertActive(): void {
    if (this.closed || this.poisoned) throw new Error('operation journal closed or uncertain');
  }
  private write(next: RecordOnDisk): void {
    this.assertActive();
    const witness: Witness = { version: 1, scope: this.scope, revision: next.revision,
      recordMac: next.mac, mac: hmac(this.key,[1,this.scope,next.revision,next.mac]) };
    try {
      save(this.dir, 'operation.json', JSON.stringify(next));
      save(this.witnessDir, 'operation.witness.json', JSON.stringify(witness));
      this.state = next;
    } catch {
      this.poisoned = true;
      throw new Error('operation journal commit uncertain: operator reconciliation required');
    }
  }
  status(): Readonly<{ phase: DurableOperationPhase; revision: number }> {
    this.assertActive();
    return Object.freeze({ phase: this.state.phase, revision: this.state.revision });
  }
  private move(from: DurableOperationPhase, to: DurableOperationPhase): void {
    this.assertActive();
    if (this.state.phase !== from) throw new Error('operation phase replay or invalid transition');
    const revision = this.state.revision + 1;
    this.write({ version: 1, scope: this.scope, phase: to, revision,
      mac: hmac(this.key,[1,this.scope,revision,to]) });
  }
  consent(): void { this.move('reserved','consented'); }
  consume(): void { this.move('consented','consuming'); }
  cancelled(): void {
    this.assertActive();
    if (this.state.phase === 'reserved') this.move('reserved','cancelled');
    else this.move('consented','cancelled');
  }
  uncertain(): void { this.move('consuming','uncertain'); }
  /** Caller-supplied verify must come from a genuine native host, never the web page. */
  async confirm(verify: () => Promise<boolean>): Promise<'confirmed' | 'uncertain'> {
    this.assertActive();
    if (this.state.phase !== 'consuming') throw new Error('operation not consuming');
    let approved = false;
    try { approved = await verify() === true; } catch { /* uncertain */ }
    if (!approved) { this.uncertain(); return 'uncertain'; }
    this.move('consuming','confirmed');
    return 'confirmed';
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.lockFD);
    unlinkSync(join(this.dir, '.fence.lock'));
    this.key.fill(0);
  }
}
