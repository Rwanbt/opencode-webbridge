/**
 * Fail-closed provider policy gate derived from a dated, reviewable policy file.
 *
 * This validates per-provider policy review metadata, not a commercial
 * licence and not a transport/session readiness certificate.
 */

export type PolicyDecision = 'restricted' | 'unverified' | 'written-authorization-required' | 'permitted';

export interface ProviderPolicyEntry {
  readonly id: string;
  readonly decision: PolicyDecision;
  readonly approved: boolean;
  readonly policyDate: string;
  readonly source: string;
  readonly finding: string;
}

export interface ProviderPolicyFile {
  readonly observedAt: string;
  readonly decisionOwner: string;
  readonly scope: string;
  readonly commercialAutomationEnabled: boolean;
  readonly providers: readonly ProviderPolicyEntry[];
}

export interface ProviderPolicyResult {
  readonly enabled: boolean;
  readonly reason:
    | 'ok'
    | 'bad-observed-at'
    | 'no-provider-opted-in'
    | 'bad-owner'
    | 'bad-scope'
    | 'bad-provider-count'
    | 'catalog-mismatch'
    | 'incoherent-opt-in'
    | 'bad-decision'
    | 'missing-date'
    | 'bad-source'
    | 'bad-finding';
}

const CATALOG = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];
const ALLOWED_DECISIONS: ReadonlySet<string> = new Set([
  'restricted', 'unverified', 'written-authorization-required',
  'permitted',
]);
const OFFICIAL_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  chatgpt: 'openai.com', deepseek: 'cdn.deepseek.com',
  gemini: 'policies.google.com', qwen: 'qwen.ai', mistral: 'mistral.ai',
});

export function validateProviderPolicy(file: unknown): ProviderPolicyResult {
  if (!file || typeof file !== 'object') return { enabled: false, reason: 'bad-observed-at' };
  const f = file as Record<string, unknown>;

  if (typeof f.observedAt !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(f.observedAt)) {
    return { enabled: false, reason: 'bad-observed-at' };
  }
  if (f.decisionOwner !== 'maintainer-review-required') {
    return { enabled: false, reason: 'bad-owner' };
  }
  if (typeof f.scope !== 'string' || !f.scope.includes('web-chat')) {
    return { enabled: false, reason: 'bad-scope' };
  }
  if (!Array.isArray(f.providers) || f.providers.length !== 5) {
    return { enabled: false, reason: 'bad-provider-count' };
  }
  const ids = f.providers.map((p: any) => p?.id).join(',');
  if (ids !== CATALOG.join(',')) {
    return { enabled: false, reason: 'catalog-mismatch' };
  }

  for (const p of f.providers as any[]) {
    if (!p || typeof p !== 'object') return { enabled: false, reason: 'bad-provider-count' };
    if (typeof p.approved !== 'boolean' || (p.approved && p.decision !== 'permitted')) {
      return { enabled: false, reason: 'incoherent-opt-in' };
    }
    if (!ALLOWED_DECISIONS.has(p.decision)) return { enabled: false, reason: 'bad-decision' };
    if (typeof p.policyDate !== 'string' || p.policyDate.length < 7) {
      return { enabled: false, reason: 'missing-date' };
    }
    let url: URL;
    try { url = new URL(p.source); } catch { return { enabled: false, reason: 'bad-source' }; }
    if (url.protocol !== 'https:' || url.username || url.password ||
        OFFICIAL_HOSTS[p.id] !== url.hostname) {
      return { enabled: false, reason: 'bad-source' };
    }
    if (typeof p.finding !== 'string' || p.finding.length < 60 || p.finding.length > 400) {
      return { enabled: false, reason: 'bad-finding' };
    }
  }

  // A user opt-in is ONLY a reviewed intent. Runtime activation additionally
  // requires the independently verified browser/session/transport contracts.
  const optedIn = (f.providers as ProviderPolicyEntry[]).some(isProviderEnabled);
  return { enabled: optedIn, reason: optedIn ? 'ok' : 'no-provider-opted-in' };
}

/** Per-provider reviewed user choice; does NOT prove a live web connection. */
export function isProviderEnabled(entry: ProviderPolicyEntry): boolean {
  return entry.decision === 'permitted' && entry.approved === true;
}
