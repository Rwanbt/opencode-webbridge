import type { WebProviderID } from '../catalog.js';
import { WEB_PROVIDER_CATALOG } from '../catalog.js';

/** Opaque IDs only. Never expose browser cookies, passwords or session tokens. */
export interface TabClaim {
  readonly sessionID: string;
  readonly providerID: WebProviderID;
  readonly tabID: string;
  readonly accountRef: string;
}

/** Data-only immutable snapshot; never let caller-owned authority cross an await. */
export function snapshotTabClaim(claim: unknown): Readonly<TabClaim> {
  const keys = ['sessionID', 'providerID', 'tabID', 'accountRef'] as const;
  if (!claim || typeof claim !== 'object' || Object.getPrototypeOf(claim) !== Object.prototype ||
    Reflect.ownKeys(claim).length !== keys.length) throw new Error('invalid browser claim shape');
  const values: Record<string, string> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(claim, key);
    if (!field || field.enumerable !== true || !Object.hasOwn(field, 'value')) {
      throw new Error('browser claim must contain plain data fields');
    }
    assertOpaqueID(field.value, `claim ${key}`);
    values[key] = field.value;
  }
  if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === values.providerID)) {
    throw new Error('unsupported browser claim provider');
  }
  return Object.freeze(values) as unknown as Readonly<TabClaim>;
}

export interface TurnRequest {
  readonly turnID: string;
  readonly prompt: string;
}

/** Before an external send, accept precisely one bounded text payload; never silently drop media. */
export function assertTextOnlyTurn(request: unknown): asserts request is TurnRequest {
  if (!request || typeof request !== 'object' || Object.getPrototypeOf(request) !== Object.prototype) {
    throw new Error('only plain text turns are supported');
  }
  const keys = Reflect.ownKeys(request);
  if (keys.length !== 2 || !keys.includes('turnID') || !keys.includes('prompt')) {
    throw new Error('unsupported turn fields or attachments');
  }
  const id = Object.getOwnPropertyDescriptor(request, 'turnID');
  const prompt = Object.getOwnPropertyDescriptor(request, 'prompt');
  if (!id || !Object.hasOwn(id, 'value') || !prompt || !Object.hasOwn(prompt, 'value')) {
    throw new Error('turn fields must be plain values');
  }
  assertOpaqueID(id.value, 'turnID');
  if (typeof prompt.value !== 'string' || !prompt.value || prompt.value.length > 16_000) {
    throw new Error('text prompt length out of bounds; media not supported');
  }
}

export type TurnEvent =
  | { readonly seq: number; readonly kind: 'text'; readonly turnID: string; readonly value: string }
  | { readonly seq: number; readonly kind: 'finished'; readonly turnID: string }
  | { readonly seq: number; readonly kind: 'cancelled'; readonly turnID: string };

/**
 * Minimal browser abstraction. A genuine driver MUST enforce the same owner checks,
 * permission boundaries and no-credentials surface as the deterministic fake.
 */
export interface BrowserPort {
  claim(binding: TabClaim): Promise<void>;
  submit(binding: TabClaim, request: TurnRequest): Promise<void>;
  events(binding: TabClaim, turnID: string, afterSeq: number): Promise<readonly TurnEvent[]>;
  cancel(binding: TabClaim, turnID: string): Promise<boolean>;
  release(binding: TabClaim): Promise<void>;
}

export function assertOpaqueID(id: string, field: string): void {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`${field}: invalid opaque identifier`);
  }
}
