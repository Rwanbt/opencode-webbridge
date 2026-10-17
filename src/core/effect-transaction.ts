/**
 * Transactional effect state machine for a single browser/native effect.
 *
 * States: authorized -> prepared -> consumed -> committed -> confirmed
 *                                                  \\-> uncertain
 *
 * An uncertain effect is NEVER silently treated as not-applied. Retry requires
 * explicit reconciliation.
 */

export type EffectPhase =
  | 'authorized'
  | 'prepared'
  | 'consumed'
  | 'committed'
  | 'confirmed'
  | 'uncertain'
  | 'reconciled';

export interface EffectRecord {
  readonly effectID: string;
  readonly phase: EffectPhase;
  readonly principal: string;
  readonly action: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export type TransitionResult =
  | { readonly ok: true; readonly phase: EffectPhase }
  | { readonly ok: false; readonly reason: string };

const ALLOWED: Record<EffectPhase, EffectPhase[]> = {
  authorized: ['prepared'],
  prepared: ['consumed', 'uncertain'],
  consumed: ['committed', 'uncertain'],
  committed: ['confirmed', 'uncertain'],
  confirmed: [],
  uncertain: ['reconciled'],
  reconciled: [],
};

export function canTransition(from: EffectPhase, to: EffectPhase): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function transitionEffect(record: EffectRecord, to: EffectPhase, now: number): TransitionResult & { record?: EffectRecord } {
  if (!canTransition(record.phase, to)) {
    return { ok: false, reason: `invalid-transition:${record.phase}->${to}` };
  }
  if (to === 'uncertain' && record.phase === 'confirmed') {
    return { ok: false, reason: 'cannot-mark-confirmed-as-uncertain' };
  }
  const next: EffectRecord = {
    ...record,
    phase: to,
    updatedAt: Number.isSafeInteger(now) && now >= 0 ? now : record.updatedAt,
  };
  return { ok: true, phase: to, record: next };
}

export function isTerminal(phase: EffectPhase): boolean {
  return phase === 'confirmed' || phase === 'uncertain' || phase === 'reconciled';
}

export function isUncertain(phase: EffectPhase): boolean {
  return phase === 'uncertain';
}

export function requiresReconciliation(phase: EffectPhase): boolean {
  return phase === 'uncertain' || phase === 'prepared' || phase === 'consumed' || phase === 'committed';
}

export function isRetrySafe(phase: EffectPhase): boolean {
  // Only 'authorized' (never prepared) is safe to retry; everything else that
  // may have produced an effect requires reconciliation first.
  return phase === 'authorized';
}
