import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { assertOpaqueID, type TabClaim } from './browser-port.js';

type Phase = 'prepared' | 'leased' | 'settled' | 'cancelled' | 'reconciled';
type Outcome = 'observed-applied' | 'observed-not-applied';
type Attestation = { outcome: Outcome; evidenceHash: string; operatorHash: string; reviewedAt: string };
type Entry = { turnID: string; phase: Phase; attestation?: Attestation };
type Payload = { version: 1; bindingHash: string; entries: Entry[] };
type State = Payload & { mac: string };
type Witness = { version: 1; bindingHash: string; journalMac: string; mac: string };

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
  private poisoned = false;

  private constructor(
    private readonly dir: string,
    private readonly lockFD: number,
    private readonly secret: string,
    private state: State,
    private readonly witnessPath?: string,
  ) {}

  private static signature(secret: string, payload: Payload): string {
    return createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(payload)).digest('hex');
  }

  private static witnessSignature(secret: string, bindingHash: string, journalMac: string): string {
    return createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(JSON.stringify([1, bindingHash, journalMac])).digest('hex');
  }

  private static verifyWitness(path: string, secret: string, journal: State): void {
    if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).size > 2048)
      throw new Error('independent witness missing or invalid: no rollback recovery');
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path, 'utf8')); }
    catch { throw new Error('invalid independent witness: torn write suspected'); }
    if (!raw || typeof raw !== 'object') throw new Error('invalid independent witness');
    const witness = raw as Witness;
    if (Object.keys(witness).sort().join(',') !== 'bindingHash,journalMac,mac,version' ||
      witness.version !== 1 || !hash(witness.bindingHash) || !hash(witness.journalMac) || !hash(witness.mac))
      throw new Error('invalid independent witness');
    const signed = DurableRelayJournal.witnessSignature(secret, witness.bindingHash, witness.journalMac);
    if (witness.bindingHash !== journal.bindingHash ||
      !timingSafeEqual(Buffer.from(signed, 'hex'), Buffer.from(witness.mac, 'hex')) ||
      witness.journalMac !== journal.mac) throw new Error('journal rollback or witness integrity mismatch');
  }

  static open(dir: string, binding: TabClaim, secret: string, witnessDir?: string): DurableRelayJournal {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('invalid journal signing key');
    for (const [key, id] of Object.entries(binding)) assertOpaqueID(id, key);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error('journal directory must not be a symlink');
    let witnessPath: string | undefined;
    if (witnessDir !== undefined) {
      if (typeof witnessDir !== 'string') throw new Error('invalid independent witness path');
      const base = resolve(dir);
      const independent = resolve(witnessDir);
      if (base === independent || base.startsWith(independent + sep) || independent.startsWith(base + sep))
        throw new Error('independent witness must be outside journal directory tree');
      mkdirSync(independent, { recursive: true, mode: 0o700 });
      if (!lstatSync(independent).isDirectory() || lstatSync(independent).isSymbolicLink())
        throw new Error('invalid independent witness directory');
      witnessPath = join(independent, 'witness.json');
    }
    let lockFD: number;
    try { lockFD = openSync(join(dir, '.lock'), 'wx', 0o600); }
    catch { throw new Error('relay journal locked: require explicit operator recovery'); }
    try {
      const path = join(dir, 'journal.json');
      const journalPresent = existsSync(path);
      if (witnessPath && journalPresent !== existsSync(witnessPath))
        throw new Error('journal rollback or missing independent witness');
      const bindingHash = identity(binding);
      let state: State = { version: 1, bindingHash, entries: [],
        mac: DurableRelayJournal.signature(secret, { version: 1, bindingHash, entries: [] }) };
      if (existsSync(path)) {
        if (!lstatSync(path).isFile() || lstatSync(path).size > 64_000) throw new Error('invalid journal');
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!DurableRelayJournal.valid(raw)) throw new Error('invalid journal');
        state = raw;
        if (state.bindingHash !== bindingHash) throw new Error('journal binding mismatch');
        const signed = DurableRelayJournal.signature(secret, {
          version: state.version, bindingHash: state.bindingHash, entries: state.entries,
        });
        if (!timingSafeEqual(Buffer.from(signed, 'hex'), Buffer.from(state.mac, 'hex'))) {
          throw new Error('journal integrity mismatch');
        }
      }
      if (witnessPath && journalPresent) DurableRelayJournal.verifyWitness(witnessPath, secret, state);
      const journal = new DurableRelayJournal(dir, lockFD, secret, state, witnessPath);
      // Persist ownership even when there are zero turns; never silently rebind.
      if (!existsSync(path)) journal.commit([]);
      return journal;
    } catch (error) {
      closeSync(lockFD);
      unlinkSync(join(dir, '.lock'));
      if (error instanceof SyntaxError) throw new Error('invalid journal');
      throw error;
    }
  }

  private static valid(raw: unknown): raw is State {
    if (!raw || typeof raw !== 'object') return false;
    const s = raw as State;
    if (s.version !== 1 || !hash(s.bindingHash) || !hash(s.mac) ||
      Object.keys(s).length !== 4 || !Array.isArray(s.entries) || s.entries.length > 16) return false;
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

  private ensure(): void {
    if (this.closed) throw new Error('journal closed');
    if (this.poisoned) throw new Error('journal/witness atomic update uncertain: operator recovery required');
  }

  status(): readonly { readonly turnID: string; readonly phase: Phase }[] {
    this.ensure();
    return this.state.entries.map(({ turnID, phase }) => ({ turnID, phase }));
  }

  assertBinding(binding: TabClaim): void {
    this.ensure();
    if (identity(binding) !== this.state.bindingHash) throw new Error('journal binding mismatch');
  }

  private writeWitness(state: State): void {
    if (!this.witnessPath) return;
    const value: Witness = { version: 1, bindingHash: state.bindingHash, journalMac: state.mac,
      mac: DurableRelayJournal.witnessSignature(this.secret, state.bindingHash, state.mac) };
    const temp = join(dirname(this.witnessPath), `.witness-${randomUUID()}.tmp`);
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(value), { encoding: 'utf8' });
      fsyncSync(fd);
    } finally { closeSync(fd); }
    try { renameSync(temp, this.witnessPath); }
    catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
    if (process.platform !== 'win32') {
      const witnessFolder = openSync(dirname(this.witnessPath), 'r');
      try { fsyncSync(witnessFolder); } finally { closeSync(witnessFolder); }
    }
  }

  private commit(entries: Entry[]): void {
    this.ensure();
    const payload: Payload = { version: 1, bindingHash: this.state.bindingHash, entries };
    const next: State = { ...payload, mac: DurableRelayJournal.signature(this.secret, payload) };
    const tmp = join(this.dir, `.journal-${randomUUID()}.tmp`);
    const fd = openSync(tmp, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(next), { encoding: 'utf8' });
      fsyncSync(fd);
    } finally { closeSync(fd); }
    try { renameSync(tmp, join(this.dir, 'journal.json')); }
    catch (error) { try { unlinkSync(tmp); } catch { /* cleanup best-effort */ } throw error; }
    // Linux: flush the renamed directory entry too. Windows does not support dir fsync.
    if (process.platform !== 'win32') {
      const directory = openSync(this.dir, 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    this.state = next;
    try { this.writeWitness(next); }
    catch {
      // The journal may have advanced but its independent witness did not.
      // Do not allow any further transitions under a diverged receipt pair.
      this.poisoned = true;
      throw new Error('journal/witness update uncertain: operator recovery required');
    }
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
    closeSync(this.lockFD);
    unlinkSync(join(this.dir, '.lock'));
  }
}
