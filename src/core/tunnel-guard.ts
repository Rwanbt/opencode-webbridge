/**
 * Browser tunnel destination guard (anti-SSRF/CSRF).
 *
 * Only loopback destinations on approved ports are allowed. Private/reserved
 * ranges, non-loopback hosts, and credential-bearing URLs are rejected.
 */

export interface TunnelTarget {
  readonly host: string;
  readonly port: number;
  readonly protocol: 'http' | 'https' | 'ws' | 'wss';
}

export type TunnelResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason:
      | 'bad-protocol'
      | 'bad-port'
      | 'non-loopback'
      | 'private-range'
      | 'credential-bearing' };

const APPROVED_PORTS = new Set([8765, 8787, 17345]);

const PRIVATE_RANGES = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^127\./, // loopback handled separately
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

export function validateTunnelTarget(target: unknown, allowCredentials = false): TunnelResult {
  if (!target || typeof target !== 'object') return { ok: false, reason: 'non-loopback' };
  const t = target as Record<string, unknown>;

  if (typeof t.protocol !== 'string' || !['http', 'https', 'ws', 'wss'].includes(t.protocol)) {
    return { ok: false, reason: 'bad-protocol' };
  }
  if (typeof t.port !== 'number' || !Number.isSafeInteger(t.port) || t.port < 1 || t.port > 65535) {
    return { ok: false, reason: 'bad-port' };
  }
  if (!APPROVED_PORTS.has(t.port)) return { ok: false, reason: 'bad-port' };

  if (typeof t.host !== 'string' || t.host.length === 0) return { ok: false, reason: 'non-loopback' };
  const host = t.host.toLowerCase();
  // Reject credential-bearing hosts (user:pass@host).
  if (host.includes('@')) return { ok: false, reason: 'credential-bearing' };

  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!isLoopback) {
    // Private/reserved ranges are never allowed even if not loopback.
    if (PRIVATE_RANGES.some((re) => re.test(host))) return { ok: false, reason: 'private-range' };
    return { ok: false, reason: 'non-loopback' };
  }
  return { ok: true };
}
