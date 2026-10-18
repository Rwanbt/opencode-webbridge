/**
 * Bounded, replay-resistant receipt for an authorized browser read.
 *
 * A receipt is issued by the native Core boundary (never by the web page or the
 * plugin caller) and binds a single read to one plugin/session/workspace/turn/tab
 * generation. The plugin side only VERIFIES receipts; it never mints them for a
 * real browser. Reuse, expiry, or any binding mismatch fails closed.
 */

export interface BrowserReadBinding {
  readonly pluginID: string;
  readonly pluginGeneration: string;
  readonly sessionID: string;
  readonly workspaceID: string;
  readonly turnID: string;
  readonly callID: string;
  readonly connectionID: string;
  readonly connectionGeneration: string;
  readonly tabID: string;
  readonly tabGeneration: string;
  readonly action: string;
  readonly permissionRevision: string;
  readonly policyEpoch: string;
}

export interface BrowserReadReceipt extends BrowserReadBinding {
  readonly ticketNonce: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason:
      | 'missing-field'
      | 'expired'
      | 'not-yet-valid'
      | 'binding-mismatch'
      | 'replayed'
      | 'invalid-nonce'
      | 'invalid-time' };

const OPAQUE = /^[A-Za-z0-9_-]{1,128}$/;
const ACTION = /^[A-Za-z0-9_.:-]{1,128}$/;
const NONCE = /^[A-Za-z0-9_-]{16,256}$/;

function isOpaque(v: unknown): v is string {
  return typeof v === 'string' && OPAQUE.test(v);
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** Validate the structural shape of a receipt without trusting its authority. */
export function isWellFormed(receipt: unknown): receipt is BrowserReadReceipt {
  if (!receipt || typeof receipt !== 'object') return false;
  const r = receipt as Record<string, unknown>;
  const opaqueFields: (keyof BrowserReadBinding)[] = [
    'pluginID', 'pluginGeneration', 'sessionID', 'workspaceID', 'turnID', 'callID',
    'connectionID', 'connectionGeneration', 'tabID', 'tabGeneration',
    'permissionRevision', 'policyEpoch',
  ];
  for (const f of opaqueFields) {
    if (!isOpaque(r[f])) return false;
  }
  if (typeof r.action !== 'string' || !ACTION.test(r.action)) return false;
  if (typeof r.ticketNonce !== 'string' || !NONCE.test(r.ticketNonce)) return false;
  if (!isTime(r.issuedAt) || !isTime(r.expiresAt)) return false;
  if ((r.expiresAt as number) <= (r.issuedAt as number)) return false;
  return true;
}

/**
 * Registry of consumed nonces. A receipt may be consumed at most once; any
 * subsequent verification with the same nonce is rejected as replayed.
 */
export class ReceiptRegistry {
  private readonly consumed = new Set<string>();

  /** Returns true the first time a nonce is consumed, false thereafter. */
  consume(nonce: string): boolean {
    if (typeof nonce !== 'string' || !NONCE.test(nonce)) return false;
    if (this.consumed.has(nonce)) return false;
    this.consumed.add(nonce);
    return true;
  }

  /** Bounded size guard: evict oldest is not supported; callers must reset per turn. */
  size(): number { return this.consumed.size; }

  reset(): void { this.consumed.clear(); }
}

export interface VerifyOptions {
  readonly binding: BrowserReadBinding;
  readonly now: number;
  readonly registry: ReceiptRegistry;
  /** Skew tolerance in ms for not-yet-valid checks. Defaults to 0. */
  readonly clockSkewMs?: number;
}

/**
 * Verify a receipt against an independently known binding. Fails closed on any
 * mismatch, expiry, replay, or malformed input.
 */
export function verifyReadReceipt(receipt: unknown, opts: VerifyOptions): VerifyResult {
  if (!isWellFormed(receipt)) return { ok: false, reason: 'missing-field' };
  const r = receipt as BrowserReadReceipt;
  const { binding, now, registry } = opts;
  const skew = opts.clockSkewMs ?? 0;

  if (!isTime(now)) return { ok: false, reason: 'invalid-time' };
  if (now + skew < r.issuedAt) return { ok: false, reason: 'not-yet-valid' };
  if (now >= r.expiresAt) return { ok: false, reason: 'expired' };

  // Binding must match the independently known authority, field by field.
  const allFields: (keyof BrowserReadBinding)[] = [
    'pluginID', 'pluginGeneration', 'sessionID', 'workspaceID', 'turnID', 'callID',
    'connectionID', 'connectionGeneration', 'tabID', 'tabGeneration', 'action',
    'permissionRevision', 'policyEpoch',
  ];
  for (const f of allFields) {
    if (r[f] !== binding[f]) return { ok: false, reason: 'binding-mismatch' };
  }

  if (!NONCE.test(r.ticketNonce)) return { ok: false, reason: 'invalid-nonce' };

  // Single-use enforcement: consume returns false on replay.
  if (!registry.consume(r.ticketNonce)) return { ok: false, reason: 'replayed' };

  return { ok: true };
}
