import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';
import { assertOpaqueID, type TabClaim } from '../core/browser-port.js';
import {
  advanceAdapterTurn, assessAdapter, startAdapterTurn, type AdapterContext,
  type AdapterHealthCode, type AdapterProgress, type AdapterTurnState, type ProviderAdapter,
} from '../core/provider-adapter-contract.js';

/** Fixture observations are invented test inputs: none proves a real web login. */
export type FixtureSource = 'fixture-ui' | 'fixture-dom' | 'fixture-cache';
export type LoginSignal = 'signed-in' | 'signed-out' | 'expired' | 'challenge' | 'rate-limited' | 'disconnected';
type Signal = { readonly status: LoginSignal; readonly seq: number; readonly source: FixtureSource };
type Slot = {
  readonly owner: TabClaim;
  readonly signals: Map<FixtureSource, Signal>;
  readonly turns: Map<string, AdapterTurnState>;
  revoked?: { readonly health: 'authentication-required' | 'session-expired'; readonly source: FixtureSource };
};

const priority: Record<FixtureSource, number> = { 'fixture-ui': 3, 'fixture-dom': 2, 'fixture-cache': 1 };
const health: Record<LoginSignal, AdapterHealthCode> = {
  'signed-in': 'ready', 'signed-out': 'authentication-required', expired: 'session-expired',
  challenge: 'challenge-human-required', 'rate-limited': 'rate-limited', disconnected: 'disconnected',
};

/** No HTTP, browser, credentials, or real provider adapter can be constructed here. */
export class OfflineAccountAdapterHarness {
  private readonly tabs = new Map<string, Slot>();
  private readonly sessions = new Map<string, string>();

  claim(binding: TabClaim): void {
    for (const [name, value] of Object.entries(binding)) assertOpaqueID(value, name);
    if (!WEB_PROVIDER_CATALOG.some(({ id }) => id === binding.providerID)) throw new Error('unknown provider');
    if (this.tabs.has(binding.tabID) || this.sessions.has(binding.sessionID)) throw new Error('already owned');
    this.tabs.set(binding.tabID, { owner: Object.freeze({ ...binding }), signals: new Map(), turns: new Map() });
    this.sessions.set(binding.sessionID, binding.tabID);
  }

  private owned(binding: TabClaim): Slot {
    const slot = this.tabs.get(binding.tabID);
    if (!slot || this.sessions.get(binding.sessionID) !== binding.tabID ||
      (Object.keys(slot.owner) as Array<keyof TabClaim>).some((key) => binding[key] !== slot.owner[key])) {
      throw new Error('account/session/tab ownership mismatch');
    }
    return slot;
  }

  release(binding: TabClaim): void {
    this.owned(binding);
    this.tabs.delete(binding.tabID);
    this.sessions.delete(binding.sessionID);
  }

  observe(binding: TabClaim, source: FixtureSource, seq: number, status: LoginSignal): void {
    const slot = this.owned(binding);
    if (!Object.hasOwn(priority, source) || !Object.hasOwn(health, status) || !Number.isSafeInteger(seq) || seq < 1 ||
      seq <= (slot.signals.get(source)?.seq ?? 0)) throw new Error('invalid or stale fixture observation');
    slot.signals.set(source, { status, seq, source });
    if (status === 'expired' || status === 'signed-out') {
      slot.revoked ??= { health: status === 'expired' ? 'session-expired' : 'authentication-required', source };
    }
    // A detached/blocked observation invalidates any unfinished local trace.
    if (status !== 'signed-in') {
      for (const [id, turn] of slot.turns) {
        if (turn.phase === 'running' || turn.phase === 'abort-pending') {
          slot.turns.set(id, advanceAdapterTurn(turn, { kind: 'uncertain', seq: turn.seq + 1, turnID: id }));
        }
      }
    }
  }

  /** Restrictive evidence wins; source order resolves competing blockers. */
  status(binding: TabClaim): { readonly health: AdapterHealthCode; readonly source: FixtureSource | null } {
    const slot = this.owned(binding);
    if (slot.revoked) return slot.revoked;
    const signals = [...slot.signals.values()];
    const blockers = signals.filter(({ status }) => status !== 'signed-in');
    const pool = blockers.length ? blockers : signals;
    pool.sort((a, b) => priority[b.source] - priority[a.source] || b.seq - a.seq);
    const winner = pool[0];
    return winner ? { health: health[winner.status], source: winner.source }
      : { health: 'authentication-required', source: null };
  }

  /** The real policy gate remains authoritative even for a mock "signed-in". */
  inspect(context: AdapterContext, turnID: string): AdapterHealthCode {
    if (context.gate.id !== context.binding.providerID) return 'account-mismatch';
    const account = this.status(context.binding).health;
    return account === 'ready' ? assessAdapter(context, turnID) : account;
  }

  private requireTraceConsent(context: AdapterContext, turnID: string): void {
    const consent = context.consent;
    if (!consent || consent.approved !== true || consent.turnID !== turnID ||
      consent.operation !== 'single-text-turn' || consent.providerID !== context.binding.providerID ||
      consent.sessionID !== context.binding.sessionID || consent.accountRef !== context.binding.accountRef ||
      context.gate.id !== context.binding.providerID) throw new Error('fixture turn consent mismatch');
  }

  /** Records a fake trace; it never submits a prompt or invokes an adapter. */
  openTrace(context: AdapterContext, turnID: string): void {
    const slot = this.owned(context.binding);
    assertOpaqueID(turnID, 'turnID');
    if (this.status(context.binding).health !== 'ready') throw new Error('fixture account blocked');
    this.requireTraceConsent(context, turnID);
    if (assessAdapter(context, turnID) === 'ready') throw new Error('fixture cannot exercise approved automation');
    if (slot.turns.has(turnID)) throw new Error('fixture turn already exists: reconcile before retry');
    slot.turns.set(turnID, startAdapterTurn(turnID));
  }

  trace(context: AdapterContext, event: AdapterProgress): AdapterTurnState {
    const slot = this.owned(context.binding);
    const previous = slot.turns.get(event.turnID);
    if (!previous) throw new Error('unknown fixture turn');
    if (this.status(context.binding).health !== 'ready') throw new Error('fixture account blocked');
    // Recheck consent on each event so a different turn/account cannot consume progress.
    this.requireTraceConsent(context, event.turnID);
    const next = advanceAdapterTurn(previous, event);
    slot.turns.set(event.turnID, next);
    return next;
  }

  requestAbort(context: AdapterContext, turnID: string): 'confirmed' | 'uncertain' {
    this.requireTraceConsent(context, turnID);
    const turn = this.owned(context.binding).turns.get(turnID);
    if (!turn) throw new Error('unknown fixture turn');
    if (turn.phase === 'aborted') return 'confirmed';
    if (turn.phase === 'running') this.trace(context, { kind: 'abort-requested', turnID, seq: turn.seq + 1 });
    return 'uncertain';
  }

  /** A ProviderAdapter-shaped surface, intentionally unable to execute. */
  adapter(id: WebProviderID): ProviderAdapter {
    if (!WEB_PROVIDER_CATALOG.some((p) => p.id === id)) throw new Error('unknown provider');
    const owner = this;
    return Object.freeze({
      id,
      async inspect(context: AdapterContext) {
        if (context.binding.providerID !== id) return 'account-mismatch';
        return owner.inspect(context, context.consent?.turnID ?? 'unconsented');
      },
      async *execute(): AsyncIterable<AdapterProgress> { throw new Error('offline fixture cannot execute'); },
      async abort(context: AdapterContext, turnID: string) {
        if (context.binding.providerID !== id) throw new Error('account mismatch');
        return owner.requestAbort(context, turnID);
      },
    });
  }
}
