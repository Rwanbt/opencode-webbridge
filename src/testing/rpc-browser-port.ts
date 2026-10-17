import { assertOpaqueID, assertTextOnlyTurn, snapshotTabClaim, type BrowserPort, type TabClaim, type TurnEvent, type TurnRequest } from '../core/browser-port.js';

export type RelayMethod = 'submit' | 'observe' | 'cancel';
export type RelayCaller = (method: RelayMethod, input: { turnID: string; prompt?: string; afterSeq?: number }) => Promise<unknown>;

/**
 * Test-only BrowserPort adapter for the supported OpenCode plugin RPC transport.
 * It does not have a tab driver; a separately authorized client must complete jobs.
 */
export class RpcBrowserFixturePort implements BrowserPort {
  private active = false;
  private readonly owner: Readonly<TabClaim>;

  constructor(owner: TabClaim, private readonly rpc: RelayCaller) { this.owner = snapshotTabClaim(owner); }

  private owned(binding: TabClaim): void {
    const current = snapshotTabClaim(binding);
    if (!this.active || Object.keys(this.owner).some((key) =>
      this.owner[key as keyof TabClaim] !== current[key as keyof TabClaim])) {
      throw new Error('RPC BrowserPort binding missing or mismatched');
    }
  }

  async claim(binding: TabClaim): Promise<void> {
    const current = snapshotTabClaim(binding);
    if (this.active || Object.keys(this.owner).some((key) =>
      this.owner[key as keyof TabClaim] !== current[key as keyof TabClaim])) {
      throw new Error('RPC BrowserPort cannot claim this binding');
    }
    this.active = true;
  }

  async submit(binding: TabClaim, request: TurnRequest): Promise<void> {
    this.owned(binding);
    assertTextOnlyTurn(request);
    const response = await this.rpc('submit', { turnID: request.turnID, prompt: request.prompt });
    if (!response || typeof response !== 'object' || !('accepted' in response) || response.accepted !== true) {
      throw new Error('RPC BrowserPort send was not accepted; reconcile before retry');
    }
  }

  async events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]> {
    this.owned(binding);
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) throw new Error('invalid RPC cursor');
    const response = await this.rpc('observe', { turnID, afterSeq });
    if (!response || typeof response !== 'object' || !('events' in response) ||
      !Array.isArray(response.events) || response.events.length > 64) {
      throw new Error('malformed RPC event batch');
    }
    // exchangeBrowserTurn validates every event's identity, cursor and content.
    return response.events as readonly TurnEvent[];
  }

  /** Cancellation is certain ONLY when the remote job has not been leased. */
  async cancel(binding: TabClaim, turnID: string): Promise<boolean> {
    this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    const response = await this.rpc('cancel', { turnID });
    if (!response || typeof response !== 'object' || !('cancelled' in response) ||
      typeof response.cancelled !== 'boolean' || Object.keys(response).length !== 1) {
      throw new Error('malformed RPC cancellation acknowledgement');
    }
    return response.cancelled;
  }

  /** Releases only local authority. Remote cleanup is separately required. */
  async release(binding: TabClaim): Promise<void> {
    this.owned(binding);
    this.active = false;
  }
}
