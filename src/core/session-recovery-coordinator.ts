/**
 * Durable session recovery coordinator (P4).
 *
 * Produces ONE explicit recovery plan combining:
 *  - the durable journal phase of the turn (possibly uncertain),
 *  - the recorded connection identity, generation and age,
 *  - the stream checkpoint (last confirmed fragment).
 *
 * Invariants:
 *  - an uncertain turn (prepared/leased) NEVER resumes and is NEVER treated as
 *    not-applied: only explicit operator reconciliation closes it;
 *  - a resume is offered only for a mid-flight READ whose identity, generation
 *    and age fully verify; replayed fragments stay rejected as duplicates;
 *  - gaps, unknown phases, malformed records and stale generations fail closed.
 */

import { assertOpaqueID } from './browser-port.js';
import { decideRecovery, type JournalPhase } from './recovery-decision.js';

export interface RecoveryIdentity {
  readonly sessionID: string;
  readonly providerID: string;
  readonly accountRef: string;
  readonly tabID: string;
  readonly tabGeneration: string;
  readonly connectionID: string;
  readonly connectionGeneration: string;
}

export type StreamPhase = 'streaming' | 'finished' | 'aborted';

export interface RecordedTurn {
  readonly turnID: string;
  readonly identity: RecoveryIdentity;
  readonly recordedAt: number;
  /** Durable journal phase; null when the turn never engaged a browser effect. */
  readonly journalPhase: JournalPhase | null;
  readonly streamPhase: StreamPhase;
  /** Highest fragment sequence durably confirmed; -1 when none. */
  readonly lastConfirmedFragment: number;
}

export type RecoveryRejectReason =
  | 'no-incoming-connection'
  | 'turn-mismatch'
  | 'session-mismatch'
  | 'provider-mismatch'
  | 'account-mismatch'
  | 'tab-mismatch'
  | 'tab-replaced'
  | 'connection-mismatch'
  | 'generation-mismatch'
  | 'stale'
  | 'invalid-record'
  | 'unknown-phase';

export type RecoveryPlan =
  | { readonly action: 'fresh-start'; readonly reason: string }
  | { readonly action: 'resume-stream'; readonly turnID: string; readonly fromFragmentIndex: number;
      readonly lastConfirmedFragment: number; readonly reason: string }
  | { readonly action: 'reconcile-required'; readonly turnID: string; readonly reason: string }
  | { readonly action: 'terminal'; readonly turnID: string;
      readonly outcome: 'settled' | 'cancelled' | 'reconciled' | 'stream-finished' | 'aborted';
      readonly streamComplete: boolean; readonly reason: string }
  | { readonly action: 'reject'; readonly reason: RecoveryRejectReason; readonly detail: string };

export interface RecoveryRequest {
  /** Persisted record of the turn; null when no turn ever engaged. */
  readonly record: RecordedTurn | null;
  /** Identity presented by the (re)connecting side; null when offline. */
  readonly incoming: RecoveryIdentity | null;
  /** Exact turn the caller claims to recover (guards cross-turn confusion). */
  readonly requestedTurnID: string;
  readonly now: number;
  readonly maxAgeMs: number;
}

function validIdentity(id: RecoveryIdentity): boolean {
  try {
    for (const [field, value] of Object.entries(id)) assertOpaqueID(value as string, field);
    return true;
  } catch {
    return false;
  }
}

const reject = (reason: RecoveryRejectReason, detail: string): RecoveryPlan =>
  ({ action: 'reject', reason, detail });

export function planRecovery(request: RecoveryRequest): RecoveryPlan {
  const { record, incoming, requestedTurnID, now, maxAgeMs } = request;
  // Nothing engaged under this coordinator: no effect can have been applied.
  if (record === null) {
    return { action: 'fresh-start', reason: 'no recorded turn: retry cannot duplicate an effect' };
  }
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    return reject('invalid-record', 'invalid time window');
  }
  try { assertOpaqueID(record.turnID, 'turnID'); } catch { return reject('invalid-record', 'invalid turn identity'); }
  if (typeof requestedTurnID !== 'string' || requestedTurnID !== record.turnID) {
    return reject('turn-mismatch', 'requested turn does not match the recorded turn');
  }
  if (!validIdentity(record.identity) || !Number.isSafeInteger(record.recordedAt) || record.recordedAt < 0) {
    return reject('invalid-record', 'invalid recorded identity');
  }
  if (!Number.isSafeInteger(record.lastConfirmedFragment) || record.lastConfirmedFragment < -1 ||
    (record.streamPhase !== 'streaming' && record.streamPhase !== 'finished' && record.streamPhase !== 'aborted')) {
    return reject('invalid-record', 'invalid stream checkpoint');
  }
  if (incoming === null) {
    return reject('no-incoming-connection', 'no verified connection to resume on');
  }
  if (!validIdentity(incoming)) {
    return reject('invalid-record', 'invalid incoming identity');
  }
  const r = record.identity;
  if (incoming.sessionID !== r.sessionID) return reject('session-mismatch', 'session identity differs');
  if (incoming.providerID !== r.providerID) return reject('provider-mismatch', 'provider differs');
  if (incoming.accountRef !== r.accountRef) return reject('account-mismatch', 'logical account differs');
  if (incoming.tabID !== r.tabID) return reject('tab-mismatch', 'tab differs');
  if (incoming.tabGeneration !== r.tabGeneration) return reject('tab-replaced', 'tab generation replaced');
  if (incoming.connectionID !== r.connectionID) return reject('connection-mismatch', 'connection differs');
  if (incoming.connectionGeneration !== r.connectionGeneration) {
    return reject('generation-mismatch', 'connection generation differs');
  }
  const age = now - record.recordedAt;
  if (age < 0 || age > maxAgeMs) return reject('stale', 'recorded turn is outside the reconnect window');

  if (record.journalPhase !== null) {
    const decision = decideRecovery(record.journalPhase);
    switch (decision.action) {
      case 'terminal-success':
        return { action: 'terminal', turnID: record.turnID, outcome: 'settled',
          streamComplete: record.streamPhase === 'finished',
          reason: 'durable journal settled; no replay or resume of a settled turn' };
      case 'terminal-cancelled':
        return { action: 'terminal', turnID: record.turnID, outcome: 'cancelled', streamComplete: false,
          reason: 'cancelled before any effect' };
      case 'terminal-reconciled':
        return { action: 'terminal', turnID: record.turnID, outcome: 'reconciled',
          streamComplete: record.streamPhase === 'finished',
          reason: 'operator attested the outcome' };
      case 'reconcile-required':
        return { action: 'reconcile-required', turnID: record.turnID,
          reason: 'turn may have been applied; explicit operator reconciliation required' };
      default:
        return reject('unknown-phase', 'unrecognized journal phase; fail closed');
    }
  }

  switch (record.streamPhase) {
    case 'finished':
      return { action: 'terminal', turnID: record.turnID, outcome: 'stream-finished', streamComplete: true,
        reason: 'read stream already finished' };
    case 'aborted':
      return { action: 'terminal', turnID: record.turnID, outcome: 'aborted', streamComplete: false,
        reason: 'read explicitly abandoned; late fragments must stay rejected' };
    default:
      return { action: 'resume-stream', turnID: record.turnID,
        fromFragmentIndex: record.lastConfirmedFragment + 1,
        lastConfirmedFragment: record.lastConfirmedFragment,
        reason: 'verified reconnection; resume after the last confirmed fragment' };
  }
}

export type FragmentAdmission =
  | { readonly admit: true }
  | { readonly admit: false; readonly reason: 'duplicate' | 'gap' | 'abandoned' | 'invalid' };

/** Idempotent admission rule for fragments arriving on a resumed stream. */
export function admitFragment(input: {
  readonly streamPhase: StreamPhase;
  readonly lastConfirmedFragment: number;
  readonly seq: number;
}): FragmentAdmission {
  const { streamPhase, lastConfirmedFragment, seq } = input;
  if (!Number.isSafeInteger(seq) || seq < 1 ||
    !Number.isSafeInteger(lastConfirmedFragment) || lastConfirmedFragment < -1) {
    return { admit: false, reason: 'invalid' };
  }
  if (streamPhase === 'aborted' || streamPhase === 'finished') return { admit: false, reason: 'abandoned' };
  if (streamPhase !== 'streaming') return { admit: false, reason: 'invalid' };
  if (seq <= lastConfirmedFragment) return { admit: false, reason: 'duplicate' };
  if (seq === lastConfirmedFragment + 1) return { admit: true };
  return { admit: false, reason: 'gap' };
}
