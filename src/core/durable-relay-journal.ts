import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertOpaqueID, type TabClaim } from './browser-port.js';

type Phase = 'prepared' | 'leased' | 'settled' | 'cancelled';
type Entry = { turnID: string; phase: Phase };
type Payload = { version: 1; bindingHash: string; entries: Entry[] };
type State = Payload & { mac: string };

const digest = (data: string) => createHash('sha256').update(data).digest('hex');
const identity = (binding: TabClaim) => digest(JSON.stringify([
  binding.sessionID, binding.providerID, binding.tabID, binding.accountRef,
]));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const phase = (v: unknown): v is Phase => v === 'prepared' || v === 'leased' || v === 'settled' || v === 'cancelled';

/** Strict, small on-disk journal. Never persists raw prompts, responses or credentials. */
export class DurableRelayJournal {
  private closed = false;

  private constructor(
    private readonly dir: string,
    private readonly lockFD: number,
    private readonly secret: string,
    private state: State,
  ) {}

  private static signature(secret: string, payload: Payload): string {
    return createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(payload)).digest('hex');
  }

  static open(dir: string, binding: TabClaim, secret: string): DurableRelayJournal {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('invalid journal signing key');
    for (const [key, id] of Object.entries(binding)) assertOpaqueID(id, key);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error('journal directory must not be a symlink');
    let lockFD: number;
    try { lockFD = openSync(join(dir, '.lock'), 'wx', 0o600); }
    catch { throw new Error('relay journal locked: require explicit operator recovery'); }
    try {
      const path = join(dir, 'journal.json');
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
      const journal = new DurableRelayJournal(dir, lockFD, secret, state);
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
        !phase(item.phase) || Object.keys(item).length !== 2) return false;
      ids.add(item.turnID);
    }
    return true;
  }

  private ensure(): void { if (this.closed) throw new Error('journal closed'); }

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
