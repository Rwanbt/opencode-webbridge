import { assertOpaqueID } from './browser-port.js';

/**
 * Reconnection safety verifier.
 *
 * A reconnection is allowed only when the new connection's identity and
 * generation match the previously recorded authority. Stale or mismatched
 * connections are rejected (fail closed). No automatic replay of uncertain
 * effects.
 */

export interface ConnectionIdentity {
  readonly connectionID: string;
  readonly connectionGeneration: string;
  readonly pluginID: string;
  readonly pluginGeneration: string;
  readonly sessionID: string;
}

export interface RecordedConnection extends ConnectionIdentity {
  readonly recordedAt: number;
}

export type ReconnectResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason:
      | 'no-prior-connection'
      | 'connection-id-mismatch'
      | 'generation-mismatch'
      | 'plugin-mismatch'
      | 'session-mismatch'
      | 'stale'
      | 'invalid-input' };

const fields = ['connectionID', 'connectionGeneration', 'pluginID', 'pluginGeneration', 'sessionID'] as const;
function detachedIdentity(raw: ConnectionIdentity): ConnectionIdentity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Object.prototype || Reflect.ownKeys(raw).length !== fields.length)
    return null;
  const result: Record<string, string> = Object.create(null);
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    try { assertOpaqueID(descriptor.value as string, field); }
    catch { return null; }
    result[field] = descriptor.value as string;
  }
  return Object.freeze(result) as unknown as ConnectionIdentity;
}

export class ReconnectionVerifier {
  private recorded: RecordedConnection | null = null;

  record(conn: ConnectionIdentity, now: number): void {
    const verified = detachedIdentity(conn);
    if (!verified) throw new Error('invalid connection identity');
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid timestamp');
    this.recorded = Object.freeze({ ...verified, recordedAt: now });
  }

  clear(): void { this.recorded = null; }

  verify(incoming: ConnectionIdentity, now: number, maxAgeMs: number): ReconnectResult {
    if (!this.recorded) return { ok: false, reason: 'no-prior-connection' };
    const valid = detachedIdentity(incoming);
    if (!valid || !Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0)
      return { ok: false, reason: 'invalid-input' };
    const r = this.recorded;
    if (valid.connectionID !== r.connectionID) return { ok: false, reason: 'connection-id-mismatch' };
    if (valid.connectionGeneration !== r.connectionGeneration) return { ok: false, reason: 'generation-mismatch' };
    if (valid.pluginID !== r.pluginID || valid.pluginGeneration !== r.pluginGeneration) {
      return { ok: false, reason: 'plugin-mismatch' };
    }
    if (valid.sessionID !== r.sessionID) return { ok: false, reason: 'session-mismatch' };
    const age = now - r.recordedAt;
    if (age < 0 || age > maxAgeMs) return { ok: false, reason: 'stale' };
    return { ok: true };
  }

  hasPrior(): boolean { return this.recorded !== null; }
}
