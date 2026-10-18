/**
 * Local encrypted downstream read sink: durable idempotent receipts only.
 * Never issues a browser command, and never authenticates the host itself.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { assertOpaqueID, type TurnEvent } from './browser-port.js';
import type { RecoveryIdentity } from './session-recovery-coordinator.js';
import { WEB_PROVIDER_CATALOG } from '../catalog.js';

type Envelope = { version: 1; scope: string; turnID: string; seq: number;
  nonce: string; tag: string; cipher: string; mac: string };
type Witness = { version: 1; scope: string; seq: number; envelopeMac: string; mac: string };
const hex64 = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const hex = (v: unknown, bytes: number): v is string =>
  typeof v === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(v);
const mac = (key: Buffer, data: unknown): string =>
  createHmac('sha256', key).update(JSON.stringify(data)).digest('hex');
const same = (a: string, b: string): boolean =>
  hex64(a) && hex64(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const exact = (obj: object, keys: readonly string[]): boolean =>
  Object.keys(obj).sort().join(',') === [...keys].sort().join(',');
const identityScope = (identity: RecoveryIdentity, turnID: string, key: Buffer): string => {
  const keys = ['sessionID', 'providerID', 'accountRef', 'tabID', 'tabGeneration',
    'connectionID', 'connectionGeneration'] as const;
  if (!identity || Object.getPrototypeOf(identity) !== Object.prototype ||
      !exact(identity, keys)) throw new Error('read sink invalid identity');
  const values = keys.map((field) => {
    const d = Object.getOwnPropertyDescriptor(identity, field);
    if (!d || !('value' in d)) throw new Error('read sink identity getter denied');
    assertOpaqueID(d.value, field);
    return d.value as string;
  });
  if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === values[1]))
    throw new Error('read sink unknown provider');
  assertOpaqueID(turnID, 'turnID');
  return mac(key, [values, turnID]);
};
const frame = (raw: TurnEvent): TurnEvent => {
  if (!raw || Object.getPrototypeOf(raw) !== Object.prototype)
    throw new Error('read sink invalid frame');
  const kindDescriptor = Object.getOwnPropertyDescriptor(raw, 'kind');
  if (!kindDescriptor || !('value' in kindDescriptor))
    throw new Error('read sink frame getter denied');
  const keys = kindDescriptor.value === 'text' ? ['kind', 'seq', 'turnID', 'value'] :
    ['kind', 'seq', 'turnID'];
  if (!exact(raw, keys)) throw new Error('read sink extra or missing frame property');
  const values = keys.map((key) => {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (!d || !('value' in d)) throw new Error('read sink frame getter denied');
    return d.value;
  });
  const [kind, seq, turnID, value] = values;
  if (!Number.isSafeInteger(seq) || (seq as number) < 1 ||
      (seq as number) > 1024 || typeof turnID !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(turnID))
    throw new Error('read sink frame identity denied');
  if (kind === 'text') {
    if (typeof value !== 'string' || value.length < 1 || value.length > 4096)
      throw new Error('read sink text budget denied');
    return Object.freeze({ kind, seq: seq as number, turnID, value });
  }
  if (kind !== 'finished' && kind !== 'cancelled')
    throw new Error('read sink unknown event');
  return Object.freeze({ kind, seq: seq as number, turnID });
};
const durableWrite = (dir: string, name: string, data: string): void => {
  const tmp = join(dir, `.ack-${randomUUID()}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, data, 'utf8'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, join(dir, name)); }
  catch (error) { try { unlinkSync(tmp); } catch { /* best effort */ } throw error; }
  if (process.platform !== 'win32') {
    const d = openSync(dir, 'r');
    try { fsyncSync(d); } finally { closeSync(d); }
  }
};

export class DurableReadAckSink {
  private closed = false;
  private poisoned = false;
  private constructor(private readonly dir: string, private readonly witnessDir: string,
    private readonly fd: number, private readonly key: Buffer, private readonly scope: string,
    private readonly turnID: string, private events: TurnEvent[]) {}

  static initialize(dir: string, witnessDir: string, identity: RecoveryIdentity,
    turnID: string, secret: string): DurableReadAckSink {
    return this.load(dir, witnessDir, identity, turnID, secret, true);
  }
  static open(dir: string, witnessDir: string, identity: RecoveryIdentity,
    turnID: string, secret: string): DurableReadAckSink {
    return this.load(dir, witnessDir, identity, turnID, secret, false);
  }
  private static load(dir: string, witnessDir: string, identity: RecoveryIdentity,
    turnID: string, secret: string, initialize: boolean): DurableReadAckSink {
    if (!hex64(secret)) throw new Error('read sink invalid encryption key');
    const key = Buffer.from(secret, 'hex'), scope = identityScope(identity, turnID, key);
    if (initialize) for (const path of [dir, witnessDir])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    for (const path of [dir, witnessDir]) {
      if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())
        throw new Error('read sink directory invalid');
    }
    const a = realpathSync(dir), b = realpathSync(witnessDir);
    if (a === b || a.startsWith(b + sep) || b.startsWith(a + sep))
      throw new Error('read sink witness must be independent');
    let fd: number;
    try { fd = openSync(join(a, '.ack.lock'), 'wx', 0o600); }
    catch { throw new Error('read sink locked: operator recovery required'); }
    try {
      const file = join(a, 'read-ack.enc.json'), proof = join(b, 'read-ack.witness.json');
      if (existsSync(file) !== existsSync(proof))
        throw new Error('read sink witness missing: operator recovery required');
      if (initialize && existsSync(file)) throw new Error('read sink already exists');
      if (!initialize && !existsSync(file)) throw new Error('read sink missing: no silent reset');
      let events: TurnEvent[] = [];
      if (existsSync(file)) {
        if (!lstatSync(file).isFile() || !lstatSync(proof).isFile() ||
            lstatSync(file).size > 100_000 || lstatSync(proof).size > 1024)
          throw new Error('read sink record invalid');
        const e = JSON.parse(readFileSync(file, 'utf8')) as Envelope;
        const w = JSON.parse(readFileSync(proof, 'utf8')) as Witness;
        if (!e || !w || !exact(e, ['version','scope','turnID','seq','nonce','tag','cipher','mac']) ||
            !exact(w, ['version','scope','seq','envelopeMac','mac']) ||
            e.version !== 1 || w.version !== 1 || e.scope !== scope || w.scope !== scope ||
            e.turnID !== turnID || !Number.isSafeInteger(e.seq) || e.seq < 0 || e.seq > 1024 ||
            w.seq !== e.seq || !hex(e.nonce, 12) || !hex(e.tag, 16) ||
            typeof e.cipher !== 'string' || e.cipher.length > 90000 ||
            !same(mac(key, [e.version,e.scope,e.turnID,e.seq,e.nonce,e.tag,e.cipher]), e.mac) ||
            !same(w.envelopeMac, e.mac) ||
            !same(mac(key, [w.version,w.scope,w.seq,w.envelopeMac]), w.mac))
          throw new Error('read sink integrity/rollback mismatch');
        const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'hex'));
        cipher.setAAD(Buffer.from(scope));
        cipher.setAuthTag(Buffer.from(e.tag, 'hex'));
        events = JSON.parse(Buffer.concat([
          cipher.update(Buffer.from(e.cipher, 'base64')), cipher.final()]).toString('utf8')) as TurnEvent[];
        if (!Array.isArray(events) || events.length !== e.seq) throw new Error('read sink sequence mismatch');
        events = events.map((raw, i) => {
          const event = frame(raw);
          if (event.turnID !== turnID || event.seq !== i + 1 ||
              (i < events.length - 1 && event.kind !== 'text'))
            throw new Error('read sink forged history');
          return event;
        });
        if (events.reduce((n, ev) => n + (ev.kind === 'text' ? ev.value.length : 0), 0) > 16_000)
          throw new Error('read sink total text exceeded');
      }
      const sink = new DurableReadAckSink(a, b, fd, key, scope, turnID, events);
      if (initialize) sink.persist([]);
      return sink;
    } catch (error) {
      closeSync(fd); unlinkSync(join(a, '.ack.lock'));
      throw error;
    }
  }

  private ensure(): void {
    if (this.closed || this.poisoned) throw new Error('read sink closed or uncertain');
  }
  private persist(events: TurnEvent[]): void {
    this.ensure();
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(this.scope));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(events)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const body = [1, this.scope, this.turnID, events.length, nonce.toString('hex'),
      tag.toString('hex'), encrypted.toString('base64')] as const;
    const e: Envelope = { version: 1, scope: this.scope, turnID: this.turnID, seq: events.length,
      nonce: body[4], tag: body[5], cipher: body[6], mac: mac(this.key, body) };
    const w: Witness = { version: 1, scope: this.scope, seq: events.length, envelopeMac: e.mac,
      mac: mac(this.key, [1, this.scope, events.length, e.mac]) };
    try {
      durableWrite(this.dir, 'read-ack.enc.json', JSON.stringify(e));
      durableWrite(this.witnessDir, 'read-ack.witness.json', JSON.stringify(w));
      this.events = events;
    } catch {
      this.poisoned = true;
      throw new Error('read sink commit uncertain: no replay before operator reconciliation');
    }
  }
  /** Idempotent only for identical (scope, turn, seq, content). Never performs browser effects. */
  async acknowledge(raw: TurnEvent): Promise<void> {
    this.ensure();
    const event = frame(raw);
    if (event.turnID !== this.turnID) throw new Error('read sink wrong turn');
    const previous = this.events[event.seq - 1];
    if (previous) {
      if (JSON.stringify(previous) !== JSON.stringify(event))
        throw new Error('read sink duplicate content conflict');
      return;
    }
    if (event.seq !== this.events.length + 1 ||
        this.events.at(-1)?.kind === 'finished' || this.events.at(-1)?.kind === 'cancelled' ||
        this.events.length >= 1024 ||
        this.events.reduce((n, ev) => n + (ev.kind === 'text' ? ev.value.length : 0), 0) +
        (event.kind === 'text' ? event.value.length : 0) > 16_000)
      throw new Error('read sink gap, terminal, or text limit');
    this.persist([...this.events, event]);
  }
  /** Returns detached local data; caller must enforce permissions before disclosing it. */
  readAll(): readonly TurnEvent[] {
    this.ensure();
    return this.events.map((event) => Object.freeze({ ...event }));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd); unlinkSync(join(this.dir, '.ack.lock'));
    this.key.fill(0);
  }
}
