/**
 * Common adapter capability contract — hardened in G134.
 *
 * An adapter must declare capabilities explicitly, but a declaration is only a
 * claim. Activation additionally requires independently verified capabilities
 * and an explicit commercial authorization decision backed by an opaque
 * evidence reference. Unknown or unverified capabilities are treated as
 * unsupported (fail-closed).
 *
 * Every input is read through own-property descriptors only: getters, proxies,
 * toJSON hooks and unexpected prototypes are rejected WITHOUT being executed.
 */
import { types } from 'node:util';
import { WEB_PROVIDER_CATALOG } from '../catalog.js';

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

/** What a bench/fixture actually observed. Absent or null means "no proof yet". */
export type VerifiedCapabilities = AdapterCapabilities;

export type PolicyDecisionValue =
  | 'restricted'
  | 'unverified'
  | 'written-authorization-required'
  | 'permitted';

export type CommercialAuthorizationStatus = PolicyDecisionValue;

export interface CommercialAuthorization {
  readonly status: CommercialAuthorizationStatus;
  /** Opaque reference to reviewed evidence. Never a token, cookie or secret. */
  readonly evidenceRef: string | null;
}

export interface AdapterContract {
  readonly identity: AdapterIdentity;
  readonly capabilities: AdapterCapabilities;
  readonly policyDecision: PolicyDecisionValue;
  readonly approved: boolean;
  /** Missing or null: structurally valid, but the adapter is never usable. */
  readonly verifiedCapabilities?: VerifiedCapabilities | null;
  /** Missing: no commercial automation proof, so the adapter is never usable. */
  readonly commercialAuthorization?: CommercialAuthorization;
}

export type ContractResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type SafeFieldResult =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, unknown> }
  | { readonly ok: false; readonly reason: string };

const CAPABILITY_FIELDS = [
  'textInput', 'textOutput', 'streaming', 'tools', 'attachments', 'interruption',
] as const;
const CORE_CAPABILITY_FIELDS = ['textInput', 'textOutput', 'streaming'] as const;
const CAPABILITY_STATES: ReadonlySet<string> = new Set(['supported', 'unsupported', 'unknown']);
const POLICY_DECISIONS: ReadonlySet<string> = new Set([
  'restricted', 'unverified', 'written-authorization-required', 'permitted',
]);
const OFFICIAL_ORIGINS: ReadonlyMap<string, string> = new Map(
  WEB_PROVIDER_CATALOG.map((provider) => [provider.id, provider.origin]),
);
const OPAQUE_REF = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Descriptor-only reader. Never executes getters, setters, proxies or toJSON:
 * proxies are refused through `util.types.isProxy`, own accessors are refused
 * before any read, and only plain objects (Object.prototype or null prototype)
 * carrying exactly the expected own string names are accepted.
 */
export function readPlainFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): SafeFieldResult {
  if (types.isProxy(value)) return { ok: false, reason: 'proxy-rejected' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not-object' };
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, reason: 'unexpected-prototype' };
  }
  if (Object.getOwnPropertySymbols(value).length > 0) return { ok: false, reason: 'symbol-key-rejected' };
  const names = Object.getOwnPropertyNames(value);
  if (names.includes('toJSON')) return { ok: false, reason: 'tojson-rejected' };
  const allowed = new Set([...required, ...optional]);
  for (const name of names) {
    if (!allowed.has(name)) return { ok: false, reason: `unexpected-field:${name}` };
  }
  const fields = new Map<string, unknown>();
  for (const name of [...required, ...optional]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor) {
      if (optional.includes(name)) continue;
      return { ok: false, reason: `missing-field:${name}` };
    }
    if (!('value' in descriptor)) return { ok: false, reason: `accessor-rejected:${name}` };
    fields.set(name, descriptor.value);
  }
  return { ok: true, fields };
}

interface ParsedContract {
  readonly declared: ReadonlyMap<string, CapabilityState>;
  readonly verified: ReadonlyMap<string, CapabilityState> | null;
  readonly policyDecision: string;
  readonly approved: boolean;
  readonly authorizationStatus: string | null;
  readonly authorizationEvidence: string | null;
}

type ParseResult =
  | { readonly ok: true; readonly value: ParsedContract }
  | { readonly ok: false; readonly reason: string };

function parseCapabilityMap(
  value: unknown,
  rejectReason: string,
  invalidReason: string,
): { readonly ok: true; readonly caps: ReadonlyMap<string, CapabilityState> } |
  { readonly ok: false; readonly reason: string } {
  const parsed = readPlainFields(value, CAPABILITY_FIELDS);
  if (!parsed.ok) return { ok: false, reason: parsed.reason === 'not-object' ? rejectReason : parsed.reason };
  const caps = new Map<string, CapabilityState>();
  for (const field of CAPABILITY_FIELDS) {
    const state = parsed.fields.get(field);
    if (typeof state !== 'string' || !CAPABILITY_STATES.has(state)) {
      return { ok: false, reason: `${invalidReason}:${field}` };
    }
    caps.set(field, state as CapabilityState);
  }
  return { ok: true, caps };
}

/** Only the exact official HTTPS origin of the declared provider is accepted. */
function checkOrigin(providerID: string, origin: string): string | null {
  if (OFFICIAL_ORIGINS.get(providerID) === origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return 'bad-origin';
  }
  if (url.protocol !== 'https:') return 'bad-origin';
  if (url.username.length > 0 || url.password.length > 0) return 'origin-credentials';
  if (url.port.length > 0) return 'origin-port';
  return 'origin-mismatch';
}

function parseContract(contract: unknown): ParseResult {
  const top = readPlainFields(contract, [], [
    'identity', 'capabilities', 'policyDecision', 'approved',
    'verifiedCapabilities', 'commercialAuthorization',
  ]);
  if (!top.ok) return top;
  const { fields } = top;

  const identityValue = fields.get('identity');
  if (identityValue === undefined) return { ok: false, reason: 'bad-identity' };
  const identity = readPlainFields(identityValue, ['providerID', 'displayName', 'origin']);
  if (!identity.ok) return { ok: false, reason: identity.reason === 'not-object' ? 'bad-identity' : identity.reason };
  const providerID = identity.fields.get('providerID');
  if (typeof providerID !== 'string' || !OFFICIAL_ORIGINS.has(providerID)) {
    return { ok: false, reason: 'unknown-provider' };
  }
  const displayName = identity.fields.get('displayName');
  if (typeof displayName !== 'string' || displayName.length === 0 || displayName.length > 200) {
    return { ok: false, reason: 'bad-display-name' };
  }
  const origin = identity.fields.get('origin');
  if (typeof origin !== 'string') return { ok: false, reason: 'bad-origin' };
  const originReason = checkOrigin(providerID, origin);
  if (originReason !== null) return { ok: false, reason: originReason };

  const capabilitiesValue = fields.get('capabilities');
  if (capabilitiesValue === undefined) return { ok: false, reason: 'bad-capabilities' };
  const declared = parseCapabilityMap(capabilitiesValue, 'bad-capabilities', 'bad-capability');
  if (!declared.ok) return declared;

  const policyDecision = fields.get('policyDecision');
  if (typeof policyDecision !== 'string' || !POLICY_DECISIONS.has(policyDecision)) {
    return { ok: false, reason: 'bad-policy-decision' };
  }
  const approved = fields.get('approved');
  if (typeof approved !== 'boolean') return { ok: false, reason: 'bad-approved' };

  const verifiedValue = fields.get('verifiedCapabilities');
  let verified: ReadonlyMap<string, CapabilityState> | null = null;
  if (verifiedValue !== undefined && verifiedValue !== null) {
    const parsedVerified = parseCapabilityMap(verifiedValue, 'bad-verified-capabilities', 'bad-verified-capability');
    if (!parsedVerified.ok) return parsedVerified;
    for (const field of CAPABILITY_FIELDS) {
      if (parsedVerified.caps.get(field) === 'supported' && declared.caps.get(field) !== 'supported') {
        return { ok: false, reason: `incoherent-verification:${field}` };
      }
    }
    verified = parsedVerified.caps;
  }

  let authorizationStatus: string | null = null;
  let authorizationEvidence: string | null = null;
  const authorizationValue = fields.get('commercialAuthorization');
  if (authorizationValue !== undefined) {
    const authorization = readPlainFields(authorizationValue, ['status', 'evidenceRef']);
    if (!authorization.ok) {
      return {
        ok: false,
        reason: authorization.reason === 'not-object' ? 'bad-authorization' : authorization.reason,
      };
    }
    const status = authorization.fields.get('status');
    if (typeof status !== 'string' || !POLICY_DECISIONS.has(status)) {
      return { ok: false, reason: 'bad-authorization-status' };
    }
    const evidenceRef = authorization.fields.get('evidenceRef');
    if (evidenceRef !== null && (typeof evidenceRef !== 'string' || !OPAQUE_REF.test(evidenceRef))) {
      return { ok: false, reason: 'bad-authorization-evidence' };
    }
    if (status === 'permitted' && evidenceRef === null) {
      return { ok: false, reason: 'missing-authorization-evidence' };
    }
    authorizationStatus = status;
    authorizationEvidence = evidenceRef as string | null;
  }

  if (approved && (policyDecision !== 'permitted' ||
    authorizationStatus !== 'permitted' || authorizationEvidence === null)) {
    return { ok: false, reason: 'incoherent-approval' };
  }

  return {
    ok: true,
    value: { declared: declared.caps, verified, policyDecision, approved, authorizationStatus, authorizationEvidence },
  };
}

export function validateAdapterContract(c: unknown): ContractResult {
  const parsed = parseContract(c);
  return parsed.ok ? { ok: true } : { ok: false, reason: parsed.reason };
}

/**
 * An adapter is usable only with declared AND verified core capabilities, an
 * approved and permitted policy, and an explicit commercial authorization
 * backed by an opaque evidence reference. Any missing proof — or any hostile
 * input — fails closed without being executed.
 */
export function isAdapterUsable(c: AdapterContract): boolean {
  const parsed = parseContract(c);
  if (!parsed.ok) return false;
  const { declared, verified, policyDecision, approved, authorizationStatus, authorizationEvidence } = parsed.value;
  return approved === true &&
    policyDecision === 'permitted' &&
    authorizationStatus === 'permitted' &&
    authorizationEvidence !== null &&
    verified !== null &&
    CORE_CAPABILITY_FIELDS.every((field) =>
      declared.get(field) === 'supported' && verified.get(field) === 'supported');
}
