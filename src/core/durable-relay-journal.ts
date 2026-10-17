import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertOpaqueID, type TabClaim } from './browser-port.js';
import { DurableWitness } from './durable-witness.js';

type Phase = 'prepared' | 'leased' | 'settled' | 'cancelled' | 'reconciled';
type Outcome = 'observed-applied' | 'observed-not-applied';
type Attestation = { outcome: Outcome; evidenceHash: string; operatorHash: string; reviewedAt: string };
type Entry = { turnID: string; phase: Phase; attestation?: Attestation };
type Payload = { version: 1 | 2; bindingHash: string; entries: Entry[]; witnessRequired?: true };
type State = Payload & { mac: string };

const digest = (data: string) => createHash('sha256').update(data).digest('hex');
const identity = (binding: TabClaim) => digest(JSON.stringify([
  binding.sessionID, binding.providerID, binding.tabID, binding.accountRef,
]));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const phase = (v: unknown): v is Phase => v === 'prepared' || v === 'leased' || v === 'settled' || v === 'cancelled' || v === 'reconciled';
const outcome = (v: unknown): v is Outcome => v === 'observed-applied' || v === 'observed-not-applied';

/** Strict, small on-disk journal. Never persists raw prompts, responses or credentials. */
export class DurableRelayJournal {
  private closed = false;

  private constructor(
    private readonly dir: string,
    private readonly lockFD: number,
    private readonly lockTag: string,
    private readonly secret: string,
    private state: State,
    private readonly witness?: DurableWitness,
  ) {}

  private static signature(secret: string, payload: Payload): string {
    return createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(payload)).digest('hex');
  }

  static open(dir: string, binding: TabClaim, secret: string,
    options?: { readonly witnessDir: string }): DurableRelayJournal {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('invalid journal signing key');
    if (options && (typeof options.witnessDir !== 'string' || !options.witnessDir.trim())) {
      throw new Error('invalid witness directory');
    }
    for (const [key, id] of Object.entries(binding)) assertOpaqueID(id, key);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error('journal directory must not be a symlink');
    let lockFD: number;
    try { lockFD = openSync(join(dir, '.lock'), 'wx', 0o600); }
    catch { throw new Error('relay journal locked: require explicit operator recovery'); }
    const lockTag = randomBytes(16).toString('hex');
    try {
      writeFileSync(lockFD, lockTag, 'utf8');
      fsyncSync(lockFD);
      const path = join(dir, 'journal.json');
      const bindingHash = identity(binding);
      const initial: Payload = options
        ? { version: 2, bindingHash, entries: [], witnessRequired: true }
        : { version: 1, bindingHash, entries: [] };
      let state: State = { ...initial, mac: DurableRelayJournal.signature(secret, initial) };
      if (existsSync(path)) {
        if (!lstatSync(path).isFile() || lstatSync(path).size > 64_000) throw new Error('invalid journal');
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!DurableRelayJournal.valid(raw)) throw new Error('invalid journal');
        state = raw;
        if (state.bindingHash !== bindingHash) throw new Error('journal binding mismatch');
        const signed = DurableRelayJournal.signature(secret, DurableRelayJournal.payload(state));
        if (!timingSafeEqual(Buffer.from(signed, 'hex'), Buffer.from(state.mac, 'hex'))) {
          throw new Error('journal integrity mismatch');
        }
        if ((state.version === 2) !== Boolean(options)) {
          throw new Error('journal witness mode mismatch: downgrade/enrollment refused');
        }
      }
      // Witness is deliberately outside the journal directory, and must already
      // match an existing journal. In particular, it cannot silently enroll old state.
      const witness = options?.witnessDir ? DurableWitness.open(dir, options.witnessDir,
        bindingHash, secret, existsSync(path), state.mac) : undefined;
      const journal = new DurableRelayJournal(dir, lockFD, lockTag, secret, state, witness);
      // Persist ownership even when there are zero turns; never silently rebind.
      if (!existsSync(path)) journal.commit([]);
      return journal;
    } catch (error) {
      const owned = DurableRelayJournal.matchesLock(dir, lockFD, lockTag);
      closeSync(lockFD);
      if (owned) unlinkSync(join(dir, '.lock'));
      if (error instanceof SyntaxError) throw new Error('invalid journal');
      throw error;
    }
  }

  private static valid(raw: unknown): raw is State {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as State;
    if ((s.version !== 1 && s.version !== 2) || !hash(s.bindingHash) || !hash(s.mac) ||
      (s.version === 1 ? Object.keys(s).length !== 4 || s.witnessRequired !== undefined
        : Object.keys(s).length !== 5 || s.witnessRequired !== true) ||
      !Array.isArray(s.entries) || s.entries.length > 16) return false;
    const ids = new Set<string>();
    for (const item of s.entries) {
      if (!item || typeof item !== 'object' || typeof item.turnID !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(item.turnID) || ids.has(item.turnID) ||
        !phase(item.phase)) return false;
      if (item.phase === 'reconciled') {
        const a = item.attestation;
        if (Object.keys(item).length !== 3 || !a || typeof a !== 'object' ||
          Object.keys(a).length !== 4 || !outcome(a.outcome) ||
          !hash(a.evidenceHash) || !hash(a.operatorHash) ||
          typeof a.reviewedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(a.reviewedAt) ||
          !Number.isFinite(Date.parse(a.reviewedAt))) return false;
      } else if (Object.keys(item).length !== 2 || item.attestation !== undefined) return false;
      ids.add(item.turnID);
    }
    return true;
  }

  private ensure(): void { if (this.closed) throw new Error('journal closed'); }

  private static payload(state: State): Payload {
    return state.version === 2
      ? { version: 2, bindingHash: state.bindingHash, entries: state.entries, witnessRequired: true }
      : { version: 1, bindingHash: state.bindingHash, entries: state.entries };
  }

  /** Detect lost or modified ownership, rather than removing another process's lock. */
  private static matchesLock(dir: string, fd: number, tag: string): boolean {
    try {
      const held = fstatSync(fd);
      const path = lstatSync(join(dir, '.lock'));
      // Windows can report dev=0 for a path while fstat(fd).dev is the volume ID.
      return path.isFile() && (process.platform === 'win32' || path.dev === held.dev) &&
        path.ino === held.ino &&
        path.size === tag.length && readFileSync(join(dir, '.lock'), 'utf8') === tag;
    } catch { return false; }
  }

  private assertLock(): void {
    if (!DurableRelayJournal.matchesLock(this.dir, this.lockFD, this.lockTag)) {
      throw new Error('journal lock ownership lost: operator recovery required');
    }
  }

  status(): readonly { readonly turnID: string; readonly phase: Phase }[] {
    this.ensure();
    return this.state.entries.map(({ turnID, phase }) => ({ turnID, phase }));
  }

  assertBinding(binding: TabClaim): void {
    this.ensure();
    if (identity(binding) !== this.state.bindingHash) throw new Error('journal binding mismatch');
  }

  private commit(entries: Entry[]): void {
    this.ensure();
    this.assertLock();
    const payload: Payload = this.state.version === 2
      ? { version: 2, bindingHash: this.state.bindingHash, entries, witnessRequired: true }
      : { version: 1, bindingHash: this.state.bindingHash, entries };
    const next: State = { ...payload, mac: DurableRelayJournal.signature(this.secret, payload) };
    const tmp = join(this.dir, `.journal-${randomUUID()}.tmp`);
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(next), { encoding: 'utf8' });
      fsyncSync(fd);
    } finally { closeSync(fd); }
    try {
      this.assertLock();
      // Advance the independent witness FIRST. Crash between both writes causes
      // fail-closed mismatch, never acceptance of a rolled-back signed journal.
      this.witness?.advance(this.state.mac, next.mac);
      renameSync(tmp, join(this.dir, 'journal.json'));
    }
    catch (error) { try { unlinkSync(tmp); } catch { /* cleanup best-effort */ } throw error; }
    // Linux: flush the renamed directory entry too. Windows does not support dir fsync.
    if (process.platform !== 'win32') {
      const directory = openSync(this.dir, 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    this.state = next;
  }

  prepare(turnID: string): void {
    this.ensure();
    assertOpaqueID(turnID, 'turnID');
    if (this.state.entries.some((item) => item.turnID === turnID)) throw new Error('turn already recorded: reconcile before retry');
    if (this.state.entries.some((item) => item.phase === 'prepared' || item.phase === 'leased')) {
      throw new Error('journal has unresolved browser effects: reconcile before new turn');
    }
    if (this.state.entries.length >= 16) throw new Error('journal full: explicit archival required');
    this.commit([...this.state.entries, { turnID, phase: 'prepared' }]);
  }

  leased(turnID: string): void { this.transition(turnID, 'prepared', 'leased'); }
  settled(turnID: string): void { this.transition(turnID, 'leased', 'settled'); }
  cancelled(turnID: string): void { this.transition(turnID, 'prepared', 'cancelled'); }

  /** Operator attests to an externally observed outcome. No browser action is executed. */
  reconcile(turnID: string, input: {
    outcome: Outcome; evidenceHash: string; operatorID: string; acknowledged: boolean;
  }): void {
    this.ensure();
    assertOpaqueID(turnID, 'turnID');
    if (!input.acknowledged) throw new Error('explicit operator acknowledgement required');
    if (!outcome(input.outcome)) throw new Error('unsupported reconciliation outcome');
    if (!hash(input.evidenceHash)) throw new Error('evidence SHA256 required');
    assertOpaqueID(input.operatorID, 'operatorID');
    const current = this.state.entries.find((entry) => entry.turnID === turnID);
    if (!current || (current.phase !== 'prepared' && current.phase !== 'leased')) {
      throw new Error('only an uncertain turn may be reconciled');
    }
    const attestation: Attestation = {
      outcome: input.outcome, evidenceHash: input.evidenceHash,
      operatorHash: digest(input.operatorID), reviewedAt: new Date().toISOString(),
    };
    this.commit(this.state.entries.map((entry) => entry.turnID === turnID
      ? { turnID, phase: 'reconciled', attestation } : entry));
  }

  private transition(turnID: string, from: Phase, to: Phase): void {
    this.ensure();
    const item = this.state.entries.find((entry) => entry.turnID === turnID);
    if (!item || item.phase !== from) throw new Error(`journal turn not ${from}: reconcile`);
    this.commit(this.state.entries.map((entry) => entry.turnID === turnID
      ? { ...entry, phase: to } : entry));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const owned = DurableRelayJournal.matchesLock(this.dir, this.lockFD, this.lockTag);
    closeSync(this.lockFD);
    if (owned) unlinkSync(join(this.dir, '.lock'));
  }
}
