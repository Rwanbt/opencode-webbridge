import type { WebProviderID } from '../catalog.js';

/** Opaque IDs only. Never expose browser cookies, passwords or session tokens. */
export interface TabClaim {
  readonly sessionID: string;
  readonly providerID: WebProviderID;
  readonly tabID: string;
  readonly accountRef: string;
}

export interface TurnRequest {
  readonly turnID: string;
  readonly prompt: string;
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
