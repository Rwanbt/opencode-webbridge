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
export type OfflineReview = 'effect-unverified' | 'observed-effect' | 'confirmed-no-effect';
export type OfflineCheckpoint = {
  readonly owner: TabClaim;
  readonly turns: readonly { readonly turnID: string; readonly seq: number }[];
};
export type OfflineErrorCategory = 'none' | 'policy' | 'identity' | 'auth' | 'consent' |
  'challenge' | 'quota' | 'connectivity' | 'layout' | 'uncertain';

/** Safe diagnostic grouping, never a provider exception or credential. */
export function classifyOfflineHealth(code: AdapterHealthCode): OfflineErrorCategory {
  switch (code) {
    case 'ready': return 'none';
    case 'policy-blocked': case 'review-required': return 'policy';
    case 'account-mismatch': return 'identity';
    case 'authentication-required': case 'session-expired': return 'auth';
    case 'consent-required': case 'capability-unavailable': return 'consent';
    case 'challenge-human-required': return 'challenge';
    case 'rate-limited': return 'quota';
    case 'transport-unavailable': case 'browser-unavailable': case 'disconnected': return 'connectivity';
    case 'layout-unknown': return 'layout';
    case 'turn-uncertain': return 'uncertain';
  }
}
type Slot = {
  readonly owner: TabClaim;
  readonly signals: Map<FixtureSource, Signal>;
  readonly highWater: Map<FixtureSource, number>;
  readonly turns: Map<string, AdapterTurnState>;
  readonly failures: Map<string, AdapterHealthCode>;
  readonly reviews: Map<string, OfflineReview>;
  manual?: 'awaiting-human' | 'confirmed' | 'signed-out' | 'expired';
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
    this.tabs.set(binding.tabID, { owner: Object.freeze({ ...binding }), signals: new Map(),
      highWater: new Map(), turns: new Map(), failures: new Map(), reviews: new Map() });
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
    const slot = this.owned(binding);
    if ([...slot.turns.values()].some((turn) => ['running', 'abort-pending', 'uncertain'].includes(turn.phase))) {
      throw new Error('unresolved fixture turn: checkpoint before release');
    }
    this.tabs.delete(binding.tabID);
    this.sessions.delete(binding.sessionID);
  }

  observe(binding: TabClaim, source: FixtureSource, seq: number, status: LoginSignal): void {
    const slot = this.owned(binding);
    if (!Object.hasOwn(priority, source) || !Object.hasOwn(health, status) || !Number.isSafeInteger(seq) || seq < 1 ||
      seq <= (slot.highWater.get(source) ?? 0)) throw new Error('invalid or stale fixture observation');
    slot.highWater.set(source, seq);
    slot.signals.set(source, { status, seq, source });
    if (status === 'expired' || status === 'signed-out') {
      slot.revoked ??= { health: status === 'expired' ? 'session-expired' : 'authentication-required', source };
    }
    if (slot.manual && status !== 'signed-in') {
      slot.manual = status === 'signed-out' ? 'signed-out' : status === 'expired' ? 'expired' : 'awaiting-human';
    }
    // A detached/blocked observation invalidates any unfinished local trace.
    if (status !== 'signed-in') this.invalidateOpenTurns(slot);
  }

  private invalidateOpenTurns(slot: Slot): void {
    for (const [turnID, state] of slot.turns) {
      if (state.phase === 'running' || state.phase === 'abort-pending') {
        slot.turns.set(turnID, advanceAdapterTurn(state, { kind: 'uncertain', seq: state.seq + 1, turnID }));
      }
    }
  }

  manualLoginStatus(binding: TabClaim): 'not-requested' | 'awaiting-human' | 'confirmed' | 'signed-out' | 'expired' {
    return this.owned(binding).manual ?? 'not-requested';
  }

  /** A manual request never opens a browser or collects credentials. */
  beginManualLogin(binding: TabClaim): void {
    const slot = this.owned(binding);
    if (slot.revoked) throw new Error('revoked fixture lease: reclaim before manual login');
    if (slot.manual === 'confirmed') throw new Error('manual login already confirmed');
    this.invalidateOpenTurns(slot);
    slot.signals.clear(); // Require a fresh observation, not an earlier cached login.
    slot.manual = 'awaiting-human';
  }

  confirmManualLogin(binding: TabClaim): void {
    const slot = this.owned(binding);
    if (slot.manual !== 'awaiting-human' || this.observedStatus(slot).health !== 'ready') {
      throw new Error('manual login requires fresh signed-in fixture evidence');
    }
    slot.manual = 'confirmed';
  }

  /** Reconnect after nonterminal challenge/disconnect; never erase turn tombstones. */
  beginReconnect(binding: TabClaim): void {
    const slot = this.owned(binding);
    if (slot.revoked) throw new Error('revoked fixture lease: reclaim before reconnect');
    if (!['disconnected', 'challenge-human-required', 'rate-limited', 'layout-unknown']
      .includes(this.observedStatus(slot).health)) throw new Error('no reconnectable fixture failure');
    this.invalidateOpenTurns(slot);
    slot.signals.clear(); // Keep per-source high-water marks to reject old observations.
    slot.manual = 'awaiting-human';
  }

  /** Restrictive evidence wins; source order resolves competing blockers. */
  private observedStatus(slot: Slot): { readonly health: AdapterHealthCode; readonly source: FixtureSource | null } {
    if (slot.revoked) return slot.revoked;
    const signals = [...slot.signals.values()];
    const blockers = signals.filter(({ status }) => status !== 'signed-in');
    const pool = blockers.length ? blockers : signals;
    pool.sort((a, b) => priority[b.source] - priority[a.source] || b.seq - a.seq);
    const winner = pool[0];
    return winner ? { health: health[winner.status], source: winner.source }
      : { health: 'authentication-required', source: null };
  }

  status(binding: TabClaim): { readonly health: AdapterHealthCode; readonly source: FixtureSource | null } {
    const slot = this.owned(binding);
    const observed = this.observedStatus(slot);
    return slot.manual === 'awaiting-human' && observed.health === 'ready'
      ? { health: 'authentication-required', source: null } : observed;
  }

  sessionDiagnostics(binding: TabClaim) {
    const slot = this.owned(binding);
    const { health: code, source } = this.status(binding);
    const turns = [...slot.turns.values()];
    return Object.freeze({ health: code, category: classifyOfflineHealth(code), source,
      manual: this.manualLoginStatus(binding), totalTurns: turns.length,
      pendingTurns: turns.filter((t) => t.phase === 'running' || t.phase === 'abort-pending').length,
      uncertainTurns: turns.filter((t) => t.phase === 'uncertain').length });
  }

  /** A restart checkpoint holds no prompt, transcript, cookie, or final response. */
  checkpoint(binding: TabClaim): OfflineCheckpoint {
    const slot = this.owned(binding);
    return { owner: { ...slot.owner }, turns: [...slot.turns.values()].map((t) => ({ turnID: t.turnID, seq: t.seq })) };
  }

  /** All restored turns become uncertain tombstones; never infer completion. */
  recover(binding: TabClaim, checkpoint: OfflineCheckpoint): void {
    const slot = this.owned(binding);
    if (!checkpoint || !checkpoint.owner ||
      (Object.keys(slot.owner) as Array<keyof TabClaim>).some((k) => checkpoint.owner[k] !== slot.owner[k])) {
      throw new Error('checkpoint ownership mismatch');
    }
    if (slot.turns.size || slot.signals.size || !Array.isArray(checkpoint.turns) || checkpoint.turns.length > 64) {
      throw new Error('checkpoint cannot overwrite an existing fixture lease');
    }
    const restored = new Map<string, AdapterTurnState>();
    for (const entry of checkpoint.turns) {
      assertOpaqueID(entry?.turnID, 'turnID');
      if (!Number.isSafeInteger(entry.seq) || entry.seq < 0 || entry.seq > 1_000_000 || restored.has(entry.turnID)) {
        throw new Error('invalid checkpoint turn');
      }
      restored.set(entry.turnID, { turnID: entry.turnID, seq: entry.seq, phase: 'uncertain', preview: '' });
    }
    for (const [id, turn] of restored) slot.turns.set(id, turn);
  }

  /** Operator review is not proof of a final answer and never permits replay. */
  reconcile(binding: TabClaim, turnID: string, evidenceRef: string, decision: OfflineReview): void {
    const slot = this.owned(binding);
    assertOpaqueID(turnID, 'turnID');
    assertOpaqueID(evidenceRef, 'evidenceRef');
    if (!['effect-unverified', 'observed-effect', 'confirmed-no-effect'].includes(decision)) {
      throw new Error('invalid operator decision');
    }
    if (slot.turns.get(turnID)?.phase !== 'uncertain') throw new Error('turn is not uncertain');
    if (slot.reviews.has(turnID)) throw new Error('turn already reviewed');
    slot.reviews.set(turnID, decision);
  }

  turnDiagnostics(binding: TabClaim, turnID: string) {
    const slot = this.owned(binding);
    const turn = slot.turns.get(turnID);
    if (!turn) throw new Error('unknown fixture turn');
    const error = slot.failures.get(turnID) ?? (turn.phase === 'uncertain' ? 'turn-uncertain' : 'ready');
    return Object.freeze({ phase: turn.phase, seq: turn.seq, previewLength: turn.preview.length,
      completed: turn.phase === 'completed', error, category: classifyOfflineHealth(error),
      review: slot.reviews.get(turnID) ?? null });
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
    if (event.kind === 'error') slot.failures.set(event.turnID, event.health);
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
