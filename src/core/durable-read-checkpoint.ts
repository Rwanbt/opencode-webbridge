/** Durable, read-only stream cursor. No browser commands, credentials or effect grants. */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { assertOpaqueID } from './browser-port.js';
import { admitFragment, planRecovery, type RecoveryIdentity, type RecoveryPlan,
  type StreamPhase, type FragmentAdmission } from './session-recovery-coordinator.js';

type Data = { version: 1; identityHash: string; turnID: string; recordedAt: number;
  streamPhase: StreamPhase; lastConfirmedFragment: number; revision: number };
type Signed = Data & { mac: string };
type Witness = { mac: string; journalMac: string; identityHash: string };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sign = (key: string, value: unknown): string => createHmac('sha256', Buffer.from(key, 'hex'))
  .update(JSON.stringify(value)).digest('hex');
const canonicalID = (identity: RecoveryIdentity): string[] => {
  const keys = ['sessionID', 'providerID', 'accountRef', 'tabID', 'tabGeneration',
    'connectionID', 'connectionGeneration'] as const;
  if (!identity || Object.keys(identity).length !== keys.length) throw new Error('invalid read identity');
  return keys.map((field) => { assertOpaqueID(identity[field], field); return identity[field]; });
};
const valid = (s: Signed): boolean => !!s && Object.keys(s).sort().join(',') ===
  'identityHash,lastConfirmedFragment,mac,recordedAt,revision,streamPhase,turnID,version' &&
  s.version === 1 && sha(s.mac) && sha(s.identityHash) &&
  typeof s.turnID === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(s.turnID) &&
  Number.isSafeInteger(s.recordedAt) && s.recordedAt >= 0 &&
  Number.isSafeInteger(s.revision) && s.revision >= 0 &&
  Number.isSafeInteger(s.lastConfirmedFragment) && s.lastConfirmedFragment >= -1 &&
  (s.streamPhase === 'streaming' || s.streamPhase === 'aborted' || s.streamPhase === 'finished');

/** Reference checkpoint store, not a trusted origin or Chromium effect authority. */
export class DurableReadCheckpoint {
  private closed = false;
  private poisoned = false;
  private constructor(private readonly dir: string, private readonly witnessDir: string,
    private readonly fd: number, private readonly secret: string,
    private readonly identity: RecoveryIdentity, private state: Signed) {}

  /** Explicit new-turn creation. Trusted caller must have already proved no prior turn exists. */
  static initialize(dir: string, witnessDir: string, identity: RecoveryIdentity, turnID: string,
    secret: string, now: number): DurableReadCheckpoint {
    return this.openInternal(dir, witnessDir, identity, turnID, secret, now, true);
  }
  /** Resume ONLY an existing signed history. Missing both files is never a fresh start. */
  static open(dir: string, witnessDir: string, identity: RecoveryIdentity, turnID: string,
    secret: string, now: number): DurableReadCheckpoint {
    return this.openInternal(dir, witnessDir, identity, turnID, secret, now, false);
  }
  private static openInternal(dir: string, witnessDir: string, identity: RecoveryIdentity, turnID: string,
    secret: string, now: number, initialize: boolean): DurableReadCheckpoint {
    if (!sha(secret)) throw new Error('invalid signing secret');
    assertOpaqueID(turnID, 'turnID');
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid timestamp');
    const identityHash = sign(secret, canonicalID(identity));
    for (const path of [dir, witnessDir]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())
        throw new Error('checkpoint directory must be real');
    }
    const a = realpathSync(dir), b = realpathSync(witnessDir);
    if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
      throw new Error('witness directory must be independent');
    const fd = (() => { try { return openSync(join(a, '.lock'), 'wx', 0o600); }
      catch { throw new Error('checkpoint locked: explicit operator recovery required'); } })();
    try {
      const file = join(a, 'checkpoint.json'), witnessPath = join(b, 'witness.json');
      if (existsSync(file) !== existsSync(witnessPath))
        throw new Error('checkpoint/witness missing: operator recovery required');
      if (initialize && existsSync(file)) throw new Error('checkpoint already initialized; resume must use open');
      if (!initialize && !existsSync(file)) throw new Error('checkpoint missing: explicit initialization required');
      const data: Data = { version: 1, identityHash, turnID, recordedAt: now,
        streamPhase: 'streaming', lastConfirmedFragment: -1, revision: 0 };
      let state: Signed = { ...data, mac: sign(secret, data) };
      if (existsSync(file)) {
        if (!lstatSync(file).isFile() || lstatSync(file).size > 4096 ||
          !lstatSync(witnessPath).isFile() || lstatSync(witnessPath).size > 1024)
          throw new Error('checkpoint or witness invalid');
        state = JSON.parse(readFileSync(file, 'utf8')) as Signed;
        if (!valid(state) || state.identityHash !== identityHash || state.turnID !== turnID)
          throw new Error('checkpoint identity/turn mismatch');
        const { mac, ...payload } = state;
        if (!timingSafeEqual(Buffer.from(sign(secret, payload), 'hex'), Buffer.from(mac, 'hex')))
          throw new Error('checkpoint integrity mismatch');
        const witness = JSON.parse(readFileSync(witnessPath, 'utf8')) as Witness;
        if (!witness || Object.keys(witness).sort().join(',') !== 'identityHash,journalMac,mac' ||
          !sha(witness.mac) || !sha(witness.journalMac) || witness.identityHash !== identityHash ||
          witness.journalMac !== mac || !timingSafeEqual(
            Buffer.from(sign(secret, [identityHash, mac]), 'hex'), Buffer.from(witness.mac, 'hex')))
          throw new Error('checkpoint rollback or witness integrity mismatch');
      }
      const store = new DurableReadCheckpoint(a, b, fd, secret, Object.freeze({ ...identity }), state);
      if (initialize) store.commit(data);
      return store;
    } catch (error) {
      closeSync(fd); unlinkSync(join(a, '.lock'));
      throw error;
    }
  }

  private ensure(): void {
    if (this.closed || this.poisoned) throw new Error('checkpoint closed or update uncertain');
  }
  private write(folder: string, file: string, body: string): void {
    const temp = join(folder, `.checkpoint-${randomUUID()}.tmp`);
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, body, 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    try { renameSync(temp, join(folder, file)); }
    catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
    if (process.platform !== 'win32') {
      const dirFD = openSync(folder, 'r');
      try { fsyncSync(dirFD); } finally { closeSync(dirFD); }
    }
  }
  private commit(data: Data): void {
    this.ensure();
    const next: Signed = { ...data, mac: sign(this.secret, data) };
    try {
      this.write(this.dir, 'checkpoint.json', JSON.stringify(next));
      const receipt: Witness = { journalMac: next.mac, identityHash: next.identityHash,
        mac: sign(this.secret, [next.identityHash, next.mac]) };
      this.write(this.witnessDir, 'witness.json', JSON.stringify(receipt));
      this.state = next;
    } catch {
      this.poisoned = true;
      throw new Error('checkpoint/witness update uncertain: operator recovery required');
    }
  }
  admit(seq: number): FragmentAdmission {
    this.ensure();
    const result = admitFragment({ streamPhase: this.state.streamPhase,
      lastConfirmedFragment: this.state.lastConfirmedFragment, seq });
    if (result.admit) this.commit({ ...this.payload(), lastConfirmedFragment: seq, revision: this.state.revision + 1 });
    return result;
  }
  private payload(): Data {
    const { mac: _mac, ...payload } = this.state;
    return payload;
  }
  abort(): void { this.end('aborted'); }
  finish(): void { this.end('finished'); }
  private end(phase: 'aborted' | 'finished'): void {
    this.ensure();
    if (this.state.streamPhase !== 'streaming') throw new Error('read already terminal');
    this.commit({ ...this.payload(), streamPhase: phase, revision: this.state.revision + 1 });
  }
  plan(incoming: RecoveryIdentity | null, now: number, maxAgeMs: number): RecoveryPlan {
    this.ensure();
    return planRecovery({ record: { turnID: this.state.turnID, identity: this.identity,
      recordedAt: this.state.recordedAt, journalPhase: null,
      streamPhase: this.state.streamPhase, lastConfirmedFragment: this.state.lastConfirmedFragment },
      incoming, requestedTurnID: this.state.turnID, now, maxAgeMs });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd); unlinkSync(join(this.dir, '.lock'));
  }
}
