/**
 * G148 offline HOST fixture: persisted G127 read receipts -> data-only SSE replay.
 * Identity originates with a trusted test harness; this is not a Core/OS authority.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { assertOpaqueID, type TurnEvent } from '../core/browser-port.js';
import { DurableReadAckSink } from '../core/durable-read-ack-sink.js';
import { DurableReadCheckpoint } from '../core/durable-read-checkpoint.js';
import type { RecoveryIdentity } from '../core/session-recovery-coordinator.js';

const fields = ['sessionID', 'providerID', 'accountRef', 'tabID', 'tabGeneration',
  'connectionID', 'connectionGeneration'] as const;
const WINDOW_MS = 30_000;
const MAX_WIRE_BYTES = 24_576;
const MAX_BATCH_FRAMES = 64;

function snapshot(raw: RecoveryIdentity): RecoveryIdentity {
  if (!raw || typeof raw !== 'object' || Object.getPrototypeOf(raw) !== Object.prototype ||
      Reflect.ownKeys(raw).sort().join(',') !== [...fields].sort().join(','))
    throw new Error('SSE identity shape denied');
  const values: Record<string, string> = {};
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!descriptor || !('value' in descriptor)) throw new Error('SSE identity getter denied');
    assertOpaqueID(descriptor.value, key);
    values[key] = descriptor.value;
  }
  return Object.freeze(values) as unknown as RecoveryIdentity;
}

export interface SseDelivery {
  readonly event: TurnEvent;
  readonly cursor: string;
  readonly wire: string;
}

/** Read-side delivery only: never submits/resends an inference turn or browser effect. */
export class OfflineSseResumeHost {
  private closed = false;
  private constructor(
    private readonly identity: RecoveryIdentity, private readonly turnID: string,
    private readonly secret: Buffer, private readonly sink: DurableReadAckSink,
    private readonly checkpoint: DurableReadCheckpoint,
  ) {}

  static initialize(root: string, raw: RecoveryIdentity, turnID: string,
    secret: string, now: number): OfflineSseResumeHost {
    return this.load(root, raw, turnID, secret, now, true);
  }
  static open(root: string, raw: RecoveryIdentity, turnID: string,
    secret: string, now: number): OfflineSseResumeHost {
    return this.load(root, raw, turnID, secret, now, false);
  }
  private static load(root: string, raw: RecoveryIdentity, turnID: string,
    secret: string, now: number, initialize: boolean): OfflineSseResumeHost {
    const identity = snapshot(raw);
    assertOpaqueID(turnID, 'turnID');
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('SSE signing key denied');
    const key = Buffer.from(secret, 'hex');
    const read = [join(root, 'read'), join(root, 'read-witness')] as const;
    const cursor = [join(root, 'cursor'), join(root, 'cursor-witness')] as const;
    const sink = initialize
      ? DurableReadAckSink.initialize(...read, identity, turnID, secret)
      : DurableReadAckSink.open(...read, identity, turnID, secret);
    let checkpoint: DurableReadCheckpoint;
    try {
      checkpoint = initialize
        ? DurableReadCheckpoint.initialize(...cursor, identity, turnID, secret, now)
        : DurableReadCheckpoint.open(...cursor, identity, turnID, secret, now);
    } catch (error) { sink.close(); key.fill(0); throw error; }
    const host = new OfflineSseResumeHost(identity, turnID, key, sink, checkpoint);
    try { host.reconcile(now); } catch (error) { host.close(); throw error; }
    return host;
  }

  private authorize(raw: RecoveryIdentity, now: number): void {
    if (this.closed) throw new Error('SSE host closed');
    const incoming = snapshot(raw);
    for (const key of fields)
      if (incoming[key] !== this.identity[key]) throw new Error(`SSE scope denied: ${key}`);
    const plan = this.checkpoint.plan(incoming, now, WINDOW_MS);
    if (plan.action !== 'resume-stream' && plan.action !== 'terminal')
      throw new Error(`SSE resume denied: ${plan.action === 'reject' ? plan.reason : plan.action}`);
  }

  /** Repair a crash between G127's fsync and G121's checkpoint using local receipts only. */
  private reconcile(now: number): void {
    this.authorize(this.identity, now);
    const plan = this.checkpoint.plan(this.identity, now, WINDOW_MS);
    const saved = this.sink.readAll();
    if (plan.action === 'terminal') {
      if ((plan.outcome === 'stream-finished' && saved.at(-1)?.kind !== 'finished') ||
          (plan.outcome === 'aborted' && saved.at(-1)?.kind !== 'cancelled'))
        throw new Error('SSE terminal checkpoint/receipt disagreement');
      return;
    }
    if (plan.action !== 'resume-stream') throw new Error('SSE recovery phase denied');
    if (plan.fromFragmentIndex > saved.length)
      throw new Error('SSE checkpoint ahead of durable receipt');
    for (const event of saved.slice(plan.fromFragmentIndex)) {
      if (!this.checkpoint.admit(event.seq - 1).admit)
        throw new Error('SSE checkpoint sequence disagreement');
      if (event.kind === 'finished') this.checkpoint.finish();
      if (event.kind === 'cancelled') this.checkpoint.abort();
    }
  }

  private cursorFor(seq: number, events: readonly TurnEvent[]): string {
    const scope = fields.map((field) => this.identity[field]);
    const digest = createHmac('sha256', this.secret)
      .update(JSON.stringify(['G148-offline-SSE-v1', scope, this.turnID, seq, events.slice(0, seq)]))
      .digest('hex');
    return `v1.${seq}.${digest}`;
  }

  /** Signed initial Last-Event-ID; does not grant authority or disclose browser data. */
  startCursor(): string {
    if (this.closed) throw new Error('SSE host closed');
    return this.cursorFor(0, []);
  }

  /** ACK is fsync'd before the frame is eligible for any SSE delivery. */
  async acknowledgeRead(raw: TurnEvent, incoming: RecoveryIdentity, now: number):
    Promise<{ readonly status: 'committed' | 'duplicate'; readonly cursor: string }> {
    this.authorize(incoming, now);
    this.reconcile(now); // A previously lost checkpoint can only recover recorded data.
    const before = this.sink.readAll().length;
    await this.sink.acknowledge(raw); // G127 validates data shape, text, turn and seq.
    this.reconcile(now);
    const events = this.sink.readAll();
    return Object.freeze({ status: events.length === before ? 'duplicate' : 'committed',
      cursor: this.cursorFor(events.length, events) });
  }

  /** A reconnect replays only encrypted, committed read receipts; no browser API exists here. */
  replay(lastEventID: string, incoming: RecoveryIdentity, now: number,
    maxBytes = MAX_WIRE_BYTES): readonly SseDelivery[] {
    this.authorize(incoming, now);
    this.reconcile(now);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_WIRE_BYTES)
      throw new Error('SSE byte budget invalid');
    const parsed = /^v1\.(0|[1-9][0-9]*)\.([a-f0-9]{64})$/.exec(lastEventID);
    const events = this.sink.readAll();
    if (!parsed) throw new Error('SSE cursor invalid');
    const seq = Number(parsed[1]);
    if (!Number.isSafeInteger(seq) || seq > events.length)
      throw new Error('SSE cursor out of range');
    const expected = this.cursorFor(seq, events).split('.').at(-1)!;
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parsed[2], 'hex')))
      throw new Error('SSE cursor scope/hash mismatch');
    const result: SseDelivery[] = [];
    let bytes = 0;
    for (const event of events.slice(seq, seq + MAX_BATCH_FRAMES)) {
      const cursor = this.cursorFor(event.seq, events);
      const wire = `id: ${cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
      const size = Buffer.byteLength(wire, 'utf8');
      if (size > maxBytes) throw new Error('SSE byte budget exceeded');
      if (bytes + size > maxBytes) break;
      bytes += size;
      result.push(Object.freeze({ event, cursor, wire }));
    }
    return Object.freeze(result);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.checkpoint.close(); }
    finally {
      try { this.sink.close(); }
      finally { this.secret.fill(0); }
    }
  }
}
