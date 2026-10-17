import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

type Evidence = { version: 1; bindingHash: string; revision: number; journalMAC: string };
type Signed = Evidence & { mac: string };
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

/** External witness. Place the witness outside the journal's writable trust boundary. */
export class DurableWitness {
  private constructor(private readonly file: string, private readonly secret: string,
    private readonly bindingHash: string, private current?: Signed) {}

  private sign(e: Evidence): string {
    return createHmac('sha256', Buffer.from(this.secret, 'hex')).update(JSON.stringify(e)).digest('hex');
  }

  static open(journalDir: string, witnessDir: string, bindingHash: string, secret: string,
    journalExists: boolean, currentMAC: string): DurableWitness {
    const a = resolve(journalDir);
    const b = resolve(witnessDir);
    const separation = relative(a, b);
    const reverse = relative(b, a);
    if (!separation || !reverse || (!separation.startsWith('..') && !isAbsolute(separation)) ||
      (!reverse.startsWith('..') && !isAbsolute(reverse))) {
      throw new Error('witness must be in a separate non-nested directory');
    }
    mkdirSync(witnessDir, { recursive: true, mode: 0o700 });
    if (!lstatSync(witnessDir).isDirectory()) throw new Error('witness directory must be regular');
    const file = join(witnessDir, `${bindingHash}.json`);
    const witness = new DurableWitness(file, secret, bindingHash);
    if (!existsSync(file)) {
      if (journalExists) throw new Error('missing witness: explicit secure enrollment required');
      return witness;
    }
    if (!journalExists || !lstatSync(file).isFile() || lstatSync(file).size > 1024) {
      throw new Error('witness cannot be reused or is invalid');
    }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); }
    catch { throw new Error('invalid witness record'); }
    if (!raw || typeof raw !== 'object') throw new Error('invalid witness record');
    const x = raw as Signed;
    if (Object.keys(x).length !== 5 || x.version !== 1 || x.bindingHash !== bindingHash ||
      !Number.isSafeInteger(x.revision) || x.revision < 0 || !sha(x.journalMAC) || !sha(x.mac)) {
      throw new Error('invalid witness record');
    }
    const { mac, ...payload } = x;
    const expected = witness.sign(payload);
    if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) {
      throw new Error('witness integrity mismatch');
    }
    if (x.journalMAC !== currentMAC) throw new Error('witness mismatch: possible signed journal rollback');
    witness.current = x;
    return witness;
  }

  advance(currentMAC: string, nextMAC: string): void {
    if (!sha(nextMAC) || (this.current && this.current.journalMAC !== currentMAC) ||
      (this.current === undefined && existsSync(this.file))) {
      throw new Error('witness ownership/rollback mismatch');
    }
    // Re-read before transition, detecting out-of-band witness replacement or deletion.
    if (this.current) {
      if (!existsSync(this.file) || readFileSync(this.file, 'utf8') !== JSON.stringify(this.current)) {
        throw new Error('witness changed outside current journal owner');
      }
    }
    const payload: Evidence = { version: 1, bindingHash: this.bindingHash,
      revision: (this.current?.revision ?? -1) + 1, journalMAC: nextMAC };
    const signed: Signed = { ...payload, mac: this.sign(payload) };
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(signed)); fsyncSync(fd); }
    finally { closeSync(fd); }
    try { renameSync(temp, this.file); }
    catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
    if (process.platform !== 'win32') {
      const parent = openSync(resolve(this.file, '..'), 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
    this.current = signed;
  }
}
