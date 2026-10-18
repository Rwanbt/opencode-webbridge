/**
 * Consent state machine for a browser host binding.
 *
 * Consent is NEVER assumed from having a tab or a prior approval. It must be
 * checked immediately before and after every data-bearing operation, and a
 * revocation during an await fails the operation.
 */

export type ConsentState = 'unknown' | 'granted' | 'revoked' | 'pending';

export interface ConsentTransition {
  readonly from: ConsentState;
  readonly to: ConsentState;
  readonly at: number;
  readonly reason?: string;
}

export class ConsentGate {
  private state: ConsentState = 'unknown';
  private history: ConsentTransition[] = [];

  constructor(initial: ConsentState = 'unknown') {
    this.state = initial;
  }

  get(): ConsentState { return this.state; }

  historyOf(): readonly ConsentTransition[] { return this.history; }

  /** Grant consent. Only from unknown/pending/revoked? Revoked requires explicit re-grant. */
  grant(now: number, reason?: string): boolean {
    if (this.state === 'granted') return true;
    this.record(this.state, 'granted', now, reason);
    this.state = 'granted';
    return true;
  }

  /** Revoke consent. Always allowed; data-bearing ops must fail afterwards. */
  revoke(now: number, reason?: string): void {
    if (this.state === 'revoked') return;
    this.record(this.state, 'revoked', now, reason);
    this.state = 'revoked';
  }

  /** Mark pending (e.g. awaiting user). */
  pending(now: number, reason?: string): void {
    if (this.state === 'granted') return; // don't downgrade a grant silently
    this.record(this.state, 'pending', now, reason);
    this.state = 'pending';
  }

  /** True only when currently granted. */
  isGranted(): boolean { return this.state === 'granted'; }

  private record(from: ConsentState, to: ConsentState, at: number, reason?: string): void {
    this.history.push({ from, to, at: Number.isSafeInteger(at) && at >= 0 ? at : 0, reason });
    if (this.history.length > 64) this.history.shift();
  }
}

/** Gate a data-bearing operation: throws if consent is not granted. */
export function requireConsent(gate: ConsentGate, label: string): void {
  if (!gate.isGranted()) throw new Error(`${label}: consent absent`);
}
