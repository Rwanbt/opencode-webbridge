import type { BrowserPort, TabClaim, TurnEvent, TurnRequest } from '../core/browser-port.js';

export type RelayMethod = 'submit' | 'poll';
export type RelayCaller = (method: RelayMethod, input: { turnID: string; prompt?: string; afterSeq?: number }) => Promise<unknown>;

/**
 * Test-only BrowserPort adapter for the supported OpenCode plugin RPC transport.
 * It does not have a tab driver; a separately authorized client must complete jobs.
 */
export class RpcBrowserFixturePort implements BrowserPort {
  private active = false;

  constructor(private readonly owner: TabClaim, private readonly rpc: RelayCaller) {}

  private owned(binding: TabClaim): void {
    if (!this.active || Object.keys(this.owner).some((key) =>
      this.owner[key as keyof TabClaim] !== binding[key as keyof TabClaim])) {
      throw new Error('RPC BrowserPort binding missing or mismatched');
    }
  }

  async claim(binding: TabClaim): Promise<void> {
    if (this.active || Object.keys(this.owner).some((key) =>
      this.owner[key as keyof TabClaim] !== binding[key as keyof TabClaim])) {
      throw new Error('RPC BrowserPort cannot claim this binding');
    }
    this.active = true;
  }

  async submit(binding: TabClaim, request: TurnRequest): Promise<void> {
    this.owned(binding);
    const response = await this.rpc('submit', { turnID: request.turnID, prompt: request.prompt });
    if (!response || typeof response !== 'object' || !('accepted' in response) || response.accepted !== true) {
      throw new Error('RPC BrowserPort send was not accepted; reconcile before retry');
    }
  }

  async events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]> {
    this.owned(binding);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('invalid RPC cursor');
    const response = await this.rpc('poll', { turnID, afterSeq });
    if (!response || typeof response !== 'object' || !('events' in response) ||
      !Array.isArray(response.events) || response.events.length > 64) throw new Error('malformed RPC events');
    return response.events.map((event): TurnEvent => {
      if (!event || typeof event !== 'object' || Array.isArray(event) ||
        !('seq' in event) || !Number.isSafeInteger(event.seq) ||
        !('turnID' in event) || event.turnID !== turnID || !('kind' in event)) {
        throw new Error('invalid streamed RPC event identity');
      }
      if (event.kind === 'text' && 'value' in event && typeof event.value === 'string' &&
        event.value.length > 0 && event.value.length <= 16_000) {
        return { seq: event.seq as number, kind: 'text', turnID, value: event.value };
      }
      if ((event.kind === 'finished' || event.kind === 'cancelled') && !('value' in event)) {
        return { seq: event.seq as number, kind: event.kind, turnID };
      }
      throw new Error('invalid streamed RPC event payload');
    });
  }

  /** Remote cancellation is not yet supported, never falsely acknowledge it. */
  async cancel(binding: TabClaim): Promise<boolean> {
    this.owned(binding);
    return false;
  }

  /** Releases only local authority. Remote cleanup is separately required. */
  async release(binding: TabClaim): Promise<void> {
    this.owned(binding);
    this.active = false;
  }
}
