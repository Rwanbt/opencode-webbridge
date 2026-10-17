/**
 * Redaction of secrets, tokens, cookies and credentials from logs/diagnostics.
 *
 * Pure, synchronous, no I/O. Used before any log export or diagnostic dump.
 */

const PATTERNS: Array<{ name: string; re: RegExp; replace: string }> = [
  { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, replace: 'Bearer [REDACTED]' },
  { name: 'jwt', re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replace: '[REDACTED_JWT]' },
  { name: 'cookie', re: /(cookie|set-cookie)\s*[:=]\s*[^\r\n]*/gi, replace: '$1: [REDACTED]' },
  { name: 'token-param', re: /([?&](?:token|access_token|api_key|apikey|secret|password|passwd|pwd)=)[^&\s]+/gi, replace: '$1[REDACTED]' },
  { name: 'basic-auth', re: /https?:\/\/[^:\s]+:[^@\s]+@/gi, replace: 'https://[REDACTED]@' },
  { name: 'hex-secret', re: /\b[a-f0-9]{32,}\b/gi, replace: '[REDACTED_HEX]' },
];

export interface RedactResult {
  readonly text: string;
  readonly redactions: number;
}

export function redactSecrets(input: string): RedactResult {
  if (typeof input !== 'string') return { text: '', redactions: 0 };
  let text = input;
  let count = 0;
  for (const p of PATTERNS) {
    const before = text;
    text = text.replace(p.re, (match) => { count++; return p.replace; });
    if (text !== before) {
      // count already incremented per match via replace callback
    }
  }
  // Count more accurately: re-run to count matches (cheap enough for diagnostics).
  let total = 0;
  for (const p of PATTERNS) {
    const m = input.match(p.re);
    if (m) total += m.length;
  }
  return { text, redactions: total };
}

export function containsSecret(input: string): boolean {
  if (typeof input !== 'string') return false;
  // The patterns are module-level /g regexes, so .test() keeps lastIndex
  // between calls: a prior match would make the next check start past the
  // secret and miss it. Reset before AND after so detection can never be
  // blinded by previous state.
  return PATTERNS.some((p) => {
    p.re.lastIndex = 0;
    const hit = p.re.test(input);
    p.re.lastIndex = 0;
    return hit;
  });
}
