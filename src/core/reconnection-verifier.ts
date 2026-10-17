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
      | 'stale' };

export class ReconnectionVerifier {
  private recorded: RecordedConnection | null = null;

  record(conn: ConnectionIdentity, now: number): void {
    if (!conn || typeof conn !== 'object') throw new Error('invalid connection');
    this.recorded = { ...conn, recordedAt: Number.isSafeInteger(now) && now >= 0 ? now : 0 };
  }

  clear(): void { this.recorded = null; }

  verify(incoming: ConnectionIdentity, now: number, maxAgeMs: number): ReconnectResult {
    if (!this.recorded) return { ok: false, reason: 'no-prior-connection' };
    const r = this.recorded;
    if (incoming.connectionID !== r.connectionID) return { ok: false, reason: 'connection-id-mismatch' };
    if (incoming.connectionGeneration !== r.connectionGeneration) return { ok: false, reason: 'generation-mismatch' };
    if (incoming.pluginID !== r.pluginID || incoming.pluginGeneration !== r.pluginGeneration) {
      return { ok: false, reason: 'plugin-mismatch' };
    }
    if (incoming.sessionID !== r.sessionID) return { ok: false, reason: 'session-mismatch' };
    const age = (Number.isSafeInteger(now) ? now : 0) - r.recordedAt;
    if (age < 0 || age > maxAgeMs) return { ok: false, reason: 'stale' };
    return { ok: true };
  }

  hasPrior(): boolean { return this.recorded !== null; }
}
