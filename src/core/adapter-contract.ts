/**
 * Common adapter capability contract.
 *
 * Every provider adapter must declare capabilities explicitly. Unknown or
 * unverified capabilities are treated as unsupported (fail-closed).
 */

export type CapabilityState = 'supported' | 'unsupported' | 'unknown';

export interface AdapterCapabilities {
  readonly textInput: CapabilityState;
  readonly textOutput: CapabilityState;
  readonly streaming: CapabilityState;
  readonly tools: CapabilityState;
  readonly attachments: CapabilityState;
  readonly interruption: CapabilityState;
}

export interface AdapterIdentity {
  readonly providerID: string;
  readonly displayName: string;
  readonly origin: string;
}

export interface AdapterContract {
  readonly identity: AdapterIdentity;
  readonly capabilities: AdapterCapabilities;
  readonly policyDecision: string;
  readonly approved: boolean;
}

export type ContractResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const KNOWN_PROVIDERS = new Set(['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral']);

export function validateAdapterContract(c: unknown): ContractResult {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'not-object' };
  const r = c as Record<string, unknown>;

  const id = r.identity as any;
  if (!id || typeof id !== 'object') return { ok: false, reason: 'bad-identity' };
  if (typeof id.providerID !== 'string' || !KNOWN_PROVIDERS.has(id.providerID)) {
    return { ok: false, reason: 'unknown-provider' };
  }
  if (typeof id.displayName !== 'string' || id.displayName.length === 0) {
    return { ok: false, reason: 'bad-display-name' };
  }
  if (typeof id.origin !== 'string' || !id.origin.startsWith('https://')) {
    return { ok: false, reason: 'bad-origin' };
  }

  const caps = r.capabilities as any;
  if (!caps || typeof caps !== 'object') return { ok: false, reason: 'bad-capabilities' };
  const capFields = ['textInput', 'textOutput', 'streaming', 'tools', 'attachments', 'interruption'];
  for (const f of capFields) {
    if (!['supported', 'unsupported', 'unknown'].includes(caps[f])) {
      return { ok: false, reason: `bad-capability:${f}` };
    }
  }

  if (typeof r.policyDecision !== 'string' || r.policyDecision.length === 0) {
    return { ok: false, reason: 'bad-policy-decision' };
  }
  if (typeof r.approved !== 'boolean') return { ok: false, reason: 'bad-approved' };

  return { ok: true };
}

/** An adapter is usable only if all core capabilities are 'supported' and approved. */
export function isAdapterUsable(c: AdapterContract): boolean {
  const caps = c.capabilities;
  return c.approved === true &&
    caps.textInput === 'supported' &&
    caps.textOutput === 'supported' &&
    caps.streaming === 'supported';
}
