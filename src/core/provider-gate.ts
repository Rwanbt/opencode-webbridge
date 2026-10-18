import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';

/** Status of independent checks, never inferred from having a browser tab. */
export type PolicyReview = 'unreviewed' | 'permitted' | 'prohibited';
export type TransportProof = 'unproven' | 'fixture-only' | 'verified';
export type BrowserProof = 'unproven' | 'unavailable' | 'verified';
export type Capability = 'supported' | 'unsupported' | 'unknown';

/** Do not model the account with an authentication cookie or raw token. */
export interface ProviderGate {
  readonly id: WebProviderID;
  readonly policy: PolicyReview;
  readonly transport: TransportProof;
  readonly browser: BrowserProof;
  readonly authenticated: boolean;
  readonly consented: boolean;
  readonly textInput: Capability;
  readonly textOutput: Capability;
  readonly tools: Capability;
  readonly streaming: Capability;
}

export type GateResult =
  | { readonly ready: true }
  | { readonly ready: false; readonly reason: 'policy' | 'transport' | 'browser' | 'auth' | 'consent' | 'capability' };

export function disabledGate(id: WebProviderID): ProviderGate {
  return Object.freeze({
    id,
    policy: 'unreviewed',
    transport: 'unproven',
    browser: 'unproven',
    authenticated: false,
    consented: false,
    textInput: 'unknown',
    textOutput: 'unknown',
    tools: 'unknown',
    streaming: 'unknown',
  });
}

/** Readiness is an AND of all independently proven requirements. */
export function evaluateGate(gate: ProviderGate): GateResult {
  if (gate.policy !== 'permitted') return { ready: false, reason: 'policy' };
  if (gate.transport !== 'verified') return { ready: false, reason: 'transport' };
  if (gate.browser !== 'verified') return { ready: false, reason: 'browser' };
  if (!gate.authenticated) return { ready: false, reason: 'auth' };
  if (!gate.consented) return { ready: false, reason: 'consent' };
  if (gate.textInput !== 'supported' || gate.textOutput !== 'supported') {
    return { ready: false, reason: 'capability' };
  }
  return { ready: true };
}

/** All catalog providers start disabled. Do not return any selectable models. */
export function initialGates(): ReadonlyMap<WebProviderID, ProviderGate> {
  return new Map(WEB_PROVIDER_CATALOG.map(({ id }) => [id, disabledGate(id)]));
}
