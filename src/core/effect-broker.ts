/**
 * Authorized effect broker: the last gate before any native effect executes.
 *
 * MISSING UPSTREAM INTERFACE (declared, P5-native): official OpenCode 2.0.29
 * exposes no native API that can attest a tool effect against live permission
 * state at the moment of execution. `NativeEffectAuthority` below is the exact
 * seam this broker requires; until such an API exists upstream, the
 * distributable plugin passes `authority: null` and every execution is refused
 * with 'no-native-authority'. This module implements the plugin-side contract,
 * ordering and fail-closed semantics only. It makes no claim that native
 * execution is available in any released OpenCode version.
 *
 * Ordering (fail-closed at every step):
 *   unknown/not-consented operation -> refuse
 *   scope mismatch (session/agent/turn/workspace) -> refuse
 *   consent absent -> refuse
 *   ticket expired -> refuse
 *   no native authority -> refuse
 *   attestation missing/epoch or policy mismatch -> refuse
 *   revocation or expiry during attestation -> refuse (nothing ran)
 *   execute -> post-execution attestation + consent recheck
 *   any uncertainty after the executor ran -> UNCERTAIN, never success,
 *   never 'not applied': the operation becomes terminal and cannot re-run.
 */

import type { AuthorityContext } from './authority-context.js';
import { isExpired } from './authority-context.js';
import type { ConsentGate } from './consent-gate.js';
import type { ToolBroker } from './tool-broker.js';

export type EffectAttestationStage = 'pre-execution' | 'post-execution';

export interface EffectAttestation {
  readonly authorityEpoch: string;
  readonly policyRevision: string;
}

/**
 * Native-side seam: re-attests live authority for a context at a stage.
 * Returning `null` means "cannot attest" and MUST lead to refusal or, after
 * the executor ran, to UNCERTAIN.
 */
export interface NativeEffectAuthority {
  attest(context: AuthorityContext, stage: EffectAttestationStage, now: number): Promise<EffectAttestation | null>;
}

export type EffectRefusalReason =
  | 'invalid-input'
  | 'operation-unknown'
  | 'operation-not-consented'
  | 'scope-mismatch'
  | 'consent-absent'
  | 'expired'
  | 'no-native-authority'
  | 'authority-attestation-missing'
  | 'authority-mismatch';

export type EffectUncertainReason =
  | 'executor-failed'
  | 'authority-lost-after-execution'
  | 'revoked-during-execution'
  | 'operation-lost-after-execution';

export type AuthorizedEffectResult<R> =
  | { readonly ok: true; readonly status: 'executed'; readonly operationID: string;
      readonly result: R; readonly attestation: EffectAttestation }
  | { readonly ok: false; readonly status: 'refused'; readonly operationID: string;
      readonly reason: EffectRefusalReason }
  | { readonly ok: false; readonly status: 'uncertain'; readonly operationID: string;
      readonly reason: EffectUncertainReason };

export interface EffectBrokerDeps {
  readonly broker: ToolBroker;
  readonly gate: ConsentGate;
  /** null in every distributed configuration today: the seam does not exist upstream. */
  readonly authority: NativeEffectAuthority | null;
  readonly now: () => number;
}

export interface AuthorizedEffectRequest<R> {
  readonly operationID: string;
  readonly context: AuthorityContext;
  /** Runs the effect only after every pre-execution check has passed. */
  readonly execute: () => Promise<R>;
}

function refused(operationID: string, reason: EffectRefusalReason): AuthorizedEffectResult<never> {
  return { ok: false, status: 'refused', operationID, reason };
}

function uncertain(operationID: string, reason: EffectUncertainReason): AuthorizedEffectResult<never> {
  return { ok: false, status: 'uncertain', operationID, reason };
}

export async function runAuthorizedEffect<R>(
  deps: EffectBrokerDeps,
  request: AuthorizedEffectRequest<R>,
): Promise<AuthorizedEffectResult<R>> {
  const { broker, gate, authority, now } = deps;
  const operationID = request.operationID;
  if (typeof operationID !== 'string' || operationID.length === 0) {
    return refused(String(operationID), 'invalid-input');
  }
  const op = broker.get(operationID);
  if (!op) return refused(operationID, 'operation-unknown');
  if (op.status !== 'consented') return refused(operationID, 'operation-not-consented');

  // The reservation's scope and the authenticated authority tuple must agree.
  const ctx = request.context;
  if (op.sessionID !== ctx.sessionID || op.agentID !== ctx.agentID ||
    op.turnID !== ctx.turnID || op.workspaceID !== ctx.workspaceID) {
    return refused(operationID, 'scope-mismatch');
  }
  if (!gate.isGranted()) return refused(operationID, 'consent-absent');
  if (isExpired(ctx, now())) return refused(operationID, 'expired');
  if (!authority) return refused(operationID, 'no-native-authority');

  // Pre-execution attestation. Nothing has run yet: every failure is a refusal.
  let pre: EffectAttestation | null;
  try {
    pre = await authority.attest(ctx, 'pre-execution', now());
  } catch {
    return refused(operationID, 'authority-attestation-missing');
  }
  if (!pre) return refused(operationID, 'authority-attestation-missing');
  if (pre.authorityEpoch !== ctx.authorityEpoch || pre.policyRevision !== ctx.policyRevision) {
    return refused(operationID, 'authority-mismatch');
  }
  // Revocation or expiry during the attestation await.
  if (!gate.isGranted()) return refused(operationID, 'consent-absent');
  if (isExpired(ctx, now())) return refused(operationID, 'expired');
  // Synchronous irreversible consume BEFORE the first possible effect, including
  // when two calls raced through async pre-execution authorization.
  if (!broker.consume(operationID)) return refused(operationID, 'operation-not-consented');

  // From here on the effect may run; no path may claim success without a
  // confirmed post-execution recheck.
  let result: R;
  try {
    result = await request.execute();
  } catch {
    broker.uncertain(operationID);
    return uncertain(operationID, 'executor-failed');
  }

  let post: EffectAttestation | null;
  try {
    post = await authority.attest(ctx, 'post-execution', now());
  } catch {
    post = null;
  }
  if (!post || post.authorityEpoch !== ctx.authorityEpoch ||
      post.policyRevision !== ctx.policyRevision || isExpired(ctx, now())) {
    broker.uncertain(operationID);
    return uncertain(operationID, 'authority-lost-after-execution');
  }
  if (!gate.isGranted()) {
    broker.uncertain(operationID);
    return uncertain(operationID, 'revoked-during-execution');
  }
  if (!broker.executed(operationID)) {
    // Someone else moved the operation while the effect ran: the outcome is
    // not provable through the broker, so it must not be reported as executed.
    broker.uncertain(operationID);
    return uncertain(operationID, 'operation-lost-after-execution');
  }
  return { ok: true, status: 'executed', operationID, result, attestation: post };
}
