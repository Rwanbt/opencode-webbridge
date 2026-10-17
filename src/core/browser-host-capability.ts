import type { Plugin } from '@opencode/plugin';
import type { BrowserPort, TabClaim, TurnEvent, TurnRequest } from './browser-port.js';
import { assertOpaqueID } from './browser-port.js';

/** Supplied by a trusted, user-authorized host; OpenCode 2.0.29 plugins have no ctx.browser. */
export interface BrowserHostRegistration {
  readonly binding: TabClaim;
  readonly port: BrowserPort;
  /** Host-owned consent state, checked again for each data-bearing operation. */
  readonly consented: () => Promise<boolean>;
}

type Permission = Pick<Plugin.Context['permission'], 'assert'>;

/** No host is registered by default. Registration does not itself convey permission. */
export class BrowserHostCapability implements BrowserPort {
  private host?: BrowserHostRegistration;
  private pending = false;
  private active = false;
  // Local tombstone: a dispatched turn is never automatically sent twice,
  // including when its acknowledgement becomes uncertain. Not durable.
  private readonly dispatched = new Set<string>();

  constructor(private readonly permission: Permission) {}

  register(host: BrowserHostRegistration): () => void {
    if (this.host) throw new Error('browser host already registered');
    for (const [key, value] of Object.entries(host.binding)) assertOpaqueID(value, key);
    // Freeze the authority tuple so the registering caller cannot retarget a live lease.
    const entry = Object.freeze({ ...host, binding: Object.freeze({ ...host.binding }) });
    this.host = entry;
    return () => {
      if (this.pending || this.active) throw new Error('release browser binding before unregister');
      if (this.host !== entry) throw new Error('browser host changed');
      this.host = undefined;
    };
  }

  private owned(binding: TabClaim, active: boolean): BrowserHostRegistration {
    const host = this.host;
    if (!host || (active && !this.active) || Object.keys(host.binding).some((key) =>
      host.binding[key as keyof TabClaim] !== binding[key as keyof TabClaim])) {
      throw new Error('browser host unavailable or owner mismatch');
    }
    return host;
  }

  private async authorize(host: BrowserHostRegistration): Promise<void> {
    if (!(await host.consented())) throw new Error('browser host consent absent');
    const sessionID = host.binding.sessionID as Parameters<Permission['assert']>[0]['sessionID'];
    // Respect the host's built-in browser deny rule before a WebBridge-specific grant.
    await this.permission.assert({ sessionID, action: 'browser', resources: ['*'] });
    await this.permission.assert({ sessionID, action: 'webbridge_browser',
      resources: [`${host.binding.providerID}:${host.binding.tabID}`] });
    // Approval may have waited for a user; consent can be revoked while it is pending.
    if (!(await host.consented())) throw new Error('browser host consent absent');
  }

  async claim(binding: TabClaim): Promise<void> {
    if (this.pending || this.active) throw new Error('browser host claim already pending or active');
    const host = this.owned(binding, false);
    this.pending = true;
    try {
      await this.authorize(host);
      await host.port.claim(binding);
      this.active = true;
    } finally {
      this.pending = false;
    }
  }

  async submit(binding: TabClaim, request: TurnRequest): Promise<void> {
    const host = this.owned(binding, true);
    await this.authorize(host);
    this.owned(binding, true);
    assertOpaqueID(request.turnID, 'turnID');
    if (this.dispatched.has(request.turnID)) throw new Error('browser turn already dispatched: reconcile before retry');
    if (this.dispatched.size >= 1024) throw new Error('browser dispatched-turn ledger full: reconcile before retry');
    this.dispatched.add(request.turnID); // Burn before the first asynchronous effect.
    try {
      await host.port.submit(binding, request);
      // Consent, permission or the active host can change while send is pending.
      await this.authorize(host);
      this.owned(binding, true);
    } catch {
      throw new Error('browser submit outcome uncertain: reconcile before retry');
    }
  }

  async events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]> {
    const host = this.owned(binding, true);
    await this.authorize(host);
    this.owned(binding, true);
    const events = await host.port.events(binding, turnID, afterSeq);
    // A browser read may have finished after approval was revoked. Never
    // release its private result on the strength of the earlier check alone.
    await this.authorize(host);
    this.owned(binding, true);
    return events;
  }

  async cancel(binding: TabClaim, turnID: string): Promise<boolean> {
    return this.owned(binding, true).port.cancel(binding, turnID);
  }

  async release(binding: TabClaim): Promise<void> {
    await this.owned(binding, true).port.release(binding);
    this.active = false;
  }
}
