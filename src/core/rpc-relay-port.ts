import { timingSafeEqual } from 'node:crypto';
import { WEB_PROVIDER_CATALOG } from '../catalog.js';
import { assertOpaqueID, type BrowserPort, type TabClaim, type TurnEvent, type TurnRequest } from './browser-port.js';
import type { DurableRelayJournal } from './durable-relay-journal.js';

type Job = { readonly turnID: string; readonly prompt: string; claimed: boolean; done: boolean;
  text: string; events: TurnEvent[] };

/**
 * A bounded, testable relay for a FUTURE user-approved desktop companion.
 * It never controls a tab, reads browser credentials, or calls a website.
 */
export class RpcRelayPort implements BrowserPort {
  private binding?: TabClaim;
  private readonly jobs = new Map<string, Job>();
  private readonly waiters = new Set<() => void>();

  constructor(private readonly secret: string, private readonly journal?: DurableRelayJournal) {
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('relay requires a 256-bit secret');
  }

  check(secret: string, binding: TabClaim): void {
    const actual = Buffer.from(secret);
    const expected = Buffer.from(this.secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('relay unauthorized');
    }
    this.owned(binding);
  }

  private owned(binding: TabClaim): void {
    if (!this.binding || Object.keys(this.binding).some((key) =>
      this.binding?.[key as keyof TabClaim] !== binding[key as keyof TabClaim])) {
      throw new Error('relay binding mismatch');
    }
  }

  async claim(binding: TabClaim): Promise<void> {
    for (const [key, value] of Object.entries(binding)) assertOpaqueID(value, key);
    this.journal?.assertBinding(binding);
    if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === binding.providerID)) {
      throw new Error('unsupported relay provider');
    }
    if (this.binding) throw new Error('relay already claimed');
    this.binding = Object.freeze({ ...binding });
  }

  async submit(binding: TabClaim, request: TurnRequest): Promise<void> {
    this.owned(binding);
    assertOpaqueID(request.turnID, 'turnID');
    if (!request.prompt || request.prompt.length > 16_000) throw new Error('relay prompt out of bounds');
    if (this.jobs.has(request.turnID)) throw new Error('relay turn already submitted');
    if ([...this.jobs.values()].some((job) => !job.done)) throw new Error('relay already busy');
    if (this.jobs.size >= 16) throw new Error('relay journal full: restart/reconcile required');
    this.journal?.prepare(request.turnID);
    this.jobs.set(request.turnID, { turnID: request.turnID, prompt: request.prompt,
      claimed: false, done: false, text: '', events: [] });
    this.notify();
  }

  /** Once claimed by a companion, a job is never re-delivered automatically. */
  take(secret: string, binding: TabClaim): { turnID: string; prompt: string } | null {
    this.check(secret, binding);
    for (const job of this.jobs.values()) {
      if (job.claimed || job.done) continue;
      this.journal?.leased(job.turnID);
      job.claimed = true;
      return { turnID: job.turnID, prompt: job.prompt };
    }
    return null;
  }

  /** Bounded, sequenced progress from a leased offline companion. Never retries a lost ACK. */
  progress(secret: string, binding: TabClaim, turnID: string, seq: number, value: string): void {
    this.check(secret, binding);
    assertOpaqueID(turnID, 'turnID');
    const job = this.jobs.get(turnID);
    if (!job || !job.claimed || job.done) throw new Error('relay turn not pending');
    if (!Number.isSafeInteger(seq) || seq !== job.events.length + 1) throw new Error('relay progress sequence mismatch');
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096 ||
      job.text.length + value.length > 16_000 || job.events.length >= 62) {
      throw new Error('relay progress out of bounds');
    }
    job.text += value;
    job.events.push({ seq, kind: 'text', turnID, value });
    this.notify();
  }

  complete(secret: string, binding: TabClaim, turnID: string, response: string): void {
    this.check(secret, binding);
    assertOpaqueID(turnID, 'turnID');
    const job = this.jobs.get(turnID);
    if (!job || !job.claimed || job.done) throw new Error('relay turn not pending');
    if (typeof response !== 'string' || !response || response.length > 16_000) {
      throw new Error('relay reply out of bounds');
    }
    if (!response.startsWith(job.text)) throw new Error('relay final response rewrote streamed text');
    const suffix = response.slice(job.text.length);
    if (job.events.length + (suffix ? 2 : 1) > 64) throw new Error('relay event limit');
    this.journal?.settled(turnID);
    if (suffix) job.events.push({ seq: job.events.length + 1, kind: 'text', turnID, value: suffix });
    job.events.push({ seq: job.events.length + 1, kind: 'finished', turnID });
    job.done = true;
    this.notify();
  }

  async events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]> {
    this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('invalid relay cursor');
    const job = this.jobs.get(turnID);
    if (!job) throw new Error('relay unknown turn');
    if (!job.events.length) await this.wait();
    this.owned(binding);
    return (this.jobs.get(turnID)?.events ?? []).filter((event) => event.seq > afterSeq);
  }

  async cancel(binding: TabClaim, turnID: string): Promise<boolean> {
    this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    const job = this.jobs.get(turnID);
    if (!job || job.done || job.claimed) return false;
    this.journal?.cancelled(turnID);
    job.events.push({ seq: 1, kind: 'cancelled', turnID });
    job.done = true;
    this.notify();
    return true;
  }

  async release(binding: TabClaim): Promise<void> {
    this.owned(binding);
    this.binding = undefined;
    this.jobs.clear();
    this.notify();
  }

  private notify(): void {
    for (const waiter of this.waiters) waiter();
    this.waiters.clear();
  }

  private async wait(): Promise<void> {
    await new Promise<void>((resolve) => {
      const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, 500);
      this.waiters.add(wake);
    });
  }
}
