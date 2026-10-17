/**
 * Pure, dependency-free recovery decision for a journaled turn.
 *
 * Encodes the rule from the transactional effect protocol: an uncertain turn
 * (prepared/leased, i.e. possibly applied) must NEVER be silently retried or
 * treated as not-applied. Only terminal states (settled, cancelled, reconciled)
 * are safe to consider finished; 'prepared'/'leased' require explicit
 * reconciliation by an operator.
 */

export type JournalPhase = 'prepared' | 'leased' | 'settled' | 'cancelled' | 'reconciled';

export type RecoveryAction =
  | 'retry-safe'          // never applied; safe to retry
  | 'reconcile-required'  // possibly applied; operator must attest
  | 'terminal-success'     // applied and confirmed
  | 'terminal-cancelled'   // cancelled before effect
  | 'terminal-reconciled'  // operator attested outcome
  | 'unknown';             // unrecognized phase -> fail closed

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly retryAllowed: boolean;
  readonly terminal: boolean;
  readonly requiresOperator: boolean;
  readonly reason: string;
}

export function decideRecovery(phase: unknown): RecoveryDecision {
  switch (phase) {
    case 'settled':
      return { action: 'terminal-success', retryAllowed: false, terminal: true,
        requiresOperator: false, reason: 'turn settled and confirmed' };
    case 'cancelled':
      return { action: 'terminal-cancelled', retryAllowed: false, terminal: true,
        requiresOperator: false, reason: 'turn cancelled before effect' };
    case 'reconciled':
      return { action: 'terminal-reconciled', retryAllowed: false, terminal: true,
        requiresOperator: false, reason: 'operator attested outcome' };
    case 'prepared':
    case 'leased':
      return { action: 'reconcile-required', retryAllowed: false, terminal: false,
        requiresOperator: true,
        reason: 'turn may have been applied; reconciliation required before any retry' };
    default:
      return { action: 'unknown', retryAllowed: false, terminal: false,
        requiresOperator: true, reason: 'unrecognized journal phase; fail closed' };
  }
}

/** True only when a retry cannot duplicate an already-applied effect. */
export function isRetrySafe(phase: unknown): boolean {
  return decideRecovery(phase).retryAllowed;
}

/** True when the turn is finished and no reconciliation is needed. */
export function isTerminal(phase: unknown): boolean {
  return decideRecovery(phase).terminal;
}
