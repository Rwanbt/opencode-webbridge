import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';
import { assertOpaqueID, type TabClaim, type TurnRequest } from './browser-port.js';
import { evaluateGate, type ProviderGate } from './provider-gate.js';

/** Evidence of browser automation permission is different from user consent. */
export type AutomationReview = 'prohibited' | 'conditional-unverified' | 'unverified' | 'approved';
export type AdapterFeature = 'manual-only' | 'blocked' | 'unverified' | 'approved';

export interface ProviderPolicyProfile {
  readonly id: WebProviderID;
  readonly termsURL: string;
  readonly termsDate: string;
  readonly reviewedOn: '2026-10-17';
  readonly automatedInput: AutomationReview;
  readonly automatedOutput: AutomationReview;
  readonly streaming: AdapterFeature;
  readonly tools: AdapterFeature;
  readonly attachments: AdapterFeature;
}

/**
 * Reviewed consumer-web terms, not API terms. There is no approved automated
 * provider as of this review. Adding an approved entry requires a new review.
 */
export const PROVIDER_POLICY_PROFILES: Readonly<Record<WebProviderID, ProviderPolicyProfile>> = Object.freeze({
  chatgpt: Object.freeze({ id: 'chatgpt', termsURL: 'https://openai.com/fr-FR/policies/eu-terms-of-use/',
    termsDate: '2026-01-16', reviewedOn: '2026-10-17', automatedInput: 'unverified',
    automatedOutput: 'prohibited', streaming: 'blocked', tools: 'blocked', attachments: 'blocked' }),
  deepseek: Object.freeze({ id: 'deepseek', termsURL: 'https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html',
    termsDate: '2026-03-27', reviewedOn: '2026-10-17', automatedInput: 'unverified',
    automatedOutput: 'prohibited', streaming: 'blocked', tools: 'blocked', attachments: 'blocked' }),
  gemini: Object.freeze({ id: 'gemini', termsURL: 'https://policies.google.com/terms',
    termsDate: '2026-07-30', reviewedOn: '2026-10-17', automatedInput: 'conditional-unverified',
    automatedOutput: 'conditional-unverified', streaming: 'unverified', tools: 'blocked', attachments: 'blocked' }),
  qwen: Object.freeze({ id: 'qwen', termsURL: 'https://qwen.ai/termsservice',
    termsDate: '2026-05-19', reviewedOn: '2026-10-17', automatedInput: 'unverified',
    automatedOutput: 'unverified', streaming: 'unverified', tools: 'blocked', attachments: 'blocked' }),
  mistral: Object.freeze({ id: 'mistral', termsURL: 'https://legal.mistral.ai/terms/eu-consumers-terms-of-service/',
    termsDate: '2026-10-08', reviewedOn: '2026-10-17', automatedInput: 'unverified',
    automatedOutput: 'prohibited', streaming: 'blocked', tools: 'blocked', attachments: 'blocked' }),
});

export type AdapterHealthCode =
  | 'policy-blocked' | 'review-required' | 'transport-unavailable'
  | 'browser-unavailable' | 'authentication-required' | 'consent-required'
  | 'account-mismatch' | 'capability-unavailable' | 'ready'
  | 'challenge-human-required' | 'rate-limited' | 'layout-unknown'
  | 'session-expired' | 'disconnected' | 'turn-uncertain';

/** Only stable, user-visible, non-secret identities may cross the adapter. */
export interface AdapterConsent {
  readonly providerID: WebProviderID;
  readonly accountRef: string;
  readonly sessionID: string;
  readonly turnID: string;
  readonly operation: 'single-text-turn';
  readonly approved: true;
}

export interface AdapterContext {
  readonly binding: TabClaim;
  readonly gate: ProviderGate;
  readonly consent: AdapterConsent | null;
}

/** An adapter must surface human challenges as health, never solve them. */
export interface ProviderAdapter {
  readonly id: WebProviderID;
  inspect(context: AdapterContext): Promise<AdapterHealthCode>;
  execute(context: AdapterContext, request: TurnRequest): AsyncIterable<AdapterProgress>;
  abort(context: AdapterContext, turnID: string): Promise<'confirmed' | 'uncertain'>;
}

/** Static policy cannot be overridden by a forged runtime gate or consent. */
export function assessAdapter(context: AdapterContext, turnID: string): AdapterHealthCode {
  const { binding, gate, consent } = context;
  if (![binding.sessionID, binding.tabID, binding.accountRef, turnID].every((id) =>
    typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) return 'account-mismatch';
  if (!WEB_PROVIDER_CATALOG.some(({ id }) => id === binding.providerID) || gate.id !== binding.providerID) {
    return 'account-mismatch';
  }
  if (!consent || consent.approved !== true || consent.operation !== 'single-text-turn' ||
    consent.turnID !== turnID) return 'consent-required';
  if (consent.providerID !== binding.providerID || consent.accountRef !== binding.accountRef ||
    consent.sessionID !== binding.sessionID) return 'account-mismatch';
  const policy = PROVIDER_POLICY_PROFILES[binding.providerID];
  if (policy.automatedInput === 'prohibited' || policy.automatedOutput === 'prohibited') return 'policy-blocked';
  if (policy.automatedInput !== 'approved' || policy.automatedOutput !== 'approved') return 'review-required';
  const result = evaluateGate(gate);
  if (!result.ready) {
    const reasons: Record<Exclude<typeof result.reason, undefined>, AdapterHealthCode> = {
      policy: 'policy-blocked', transport: 'transport-unavailable', browser: 'browser-unavailable',
      auth: 'authentication-required', consent: 'consent-required', capability: 'capability-unavailable',
    };
    return reasons[result.reason];
  }
  return 'ready';
}

/** All future callers should use this boundary rather than invoking execute directly. */
export async function* authorizedAdapterEvents(
  adapter: ProviderAdapter, context: AdapterContext, request: TurnRequest,
): AsyncIterable<AdapterProgress> {
  assertOpaqueID(request.turnID, 'turnID');
  const health = assessAdapter(context, request.turnID);
  if (adapter.id !== context.binding.providerID || health !== 'ready') {
    throw new Error(`adapter blocked: ${adapter.id !== context.binding.providerID ? 'account-mismatch' : health}`);
  }
  let state = startAdapterTurn(request.turnID);
  for await (const event of adapter.execute(context, request)) {
    state = advanceAdapterTurn(state, event);
    yield event;
  }
  if (!['completed', 'aborted', 'failed'].includes(state.phase)) {
    throw new Error('adapter turn uncertain: reconcile before retry');
  }
}

/** Partial text is a preview, never a completed model reply. */
export type AdapterProgress =
  | { readonly kind: 'partial'; readonly turnID: string; readonly seq: number; readonly text: string }
  | { readonly kind: 'complete'; readonly turnID: string; readonly seq: number; readonly text: string }
  | { readonly kind: 'abort-requested'; readonly turnID: string; readonly seq: number }
  | { readonly kind: 'abort-confirmed'; readonly turnID: string; readonly seq: number }
  | { readonly kind: 'uncertain'; readonly turnID: string; readonly seq: number }
  | { readonly kind: 'error'; readonly turnID: string; readonly seq: number; readonly health: AdapterHealthCode };

export interface AdapterTurnState {
  readonly turnID: string;
  readonly seq: number;
  readonly phase: 'running' | 'abort-pending' | 'completed' | 'aborted' | 'uncertain' | 'failed';
  readonly preview: string;
  readonly final?: string;
}

export function startAdapterTurn(turnID: string): AdapterTurnState {
  return { turnID, seq: 0, phase: 'running', preview: '' };
}

export function advanceAdapterTurn(state: AdapterTurnState, event: AdapterProgress): AdapterTurnState {
  if (state.turnID !== event.turnID || event.seq !== state.seq + 1 ||
    !['running', 'abort-pending'].includes(state.phase)) throw new Error('invalid adapter transition');
  if (state.phase === 'abort-pending' && (event.kind === 'partial' || event.kind === 'complete')) {
    throw new Error('turn requires reconciliation after abort request');
  }
  if ((event.kind === 'abort-requested' && state.phase !== 'running') ||
    (event.kind === 'abort-confirmed' && state.phase !== 'abort-pending')) {
    throw new Error('invalid abort transition');
  }
  const next = { ...state, seq: event.seq };
  switch (event.kind) {
    case 'partial':
      if (!event.text || state.preview.length + event.text.length > 16_000) throw new Error('invalid partial');
      return { ...next, preview: state.preview + event.text };
    case 'complete':
      if (!event.text || event.text.length > 16_000) throw new Error('invalid completion');
      return { ...next, phase: 'completed', final: event.text };
    case 'abort-requested': return { ...next, phase: 'abort-pending' };
    case 'abort-confirmed': return { ...next, phase: 'aborted' };
    case 'uncertain': return { ...next, phase: 'uncertain' };
    case 'error':
      if (event.health === 'ready') throw new Error('error event cannot be healthy');
      return { ...next, phase: 'failed' };
  }
}
