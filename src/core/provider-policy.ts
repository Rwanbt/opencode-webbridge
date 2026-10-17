/**
 * Fail-closed provider policy gate derived from a dated, reviewable policy file.
 *
 * A provider is enabled ONLY when every independent check passes. Any missing
 * evidence, unverified approval, or non-official source keeps it disabled.
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
    | 'automation-not-authorized'
    | 'bad-owner'
    | 'bad-scope'
    | 'bad-provider-count'
    | 'catalog-mismatch'
    | 'unapproved'
    | 'bad-decision'
    | 'missing-date'
    | 'bad-source'
    | 'bad-finding';
}

const CATALOG = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];
const ALLOWED_DECISIONS: ReadonlySet<string> = new Set([
  'restricted', 'unverified', 'written-authorization-required',
]);
const OFFICIAL_HOSTS = new Set([
  'openai.com', 'cdn.deepseek.com', 'policies.google.com', 'qwen.ai', 'mistral.ai',
]);

export function validateProviderPolicy(file: unknown): ProviderPolicyResult {
  if (!file || typeof file !== 'object') return { enabled: false, reason: 'bad-observed-at' };
  const f = file as Record<string, unknown>;

  if (typeof f.observedAt !== 'string' || f.observedAt !== '2026-10-17') {
    return { enabled: false, reason: 'bad-observed-at' };
  }
  if (f.commercialAutomationEnabled !== false) {
    return { enabled: false, reason: 'automation-not-authorized' };
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
    if (p.approved !== false) return { enabled: false, reason: 'unapproved' };
    if (!ALLOWED_DECISIONS.has(p.decision)) return { enabled: false, reason: 'bad-decision' };
    if (typeof p.policyDate !== 'string' || p.policyDate.length < 7) {
      return { enabled: false, reason: 'missing-date' };
    }
    let url: URL;
    try { url = new URL(p.source); } catch { return { enabled: false, reason: 'bad-source' }; }
    if (url.protocol !== 'https:' || url.username || url.password ||
        !OFFICIAL_HOSTS.has(url.hostname)) {
      return { enabled: false, reason: 'bad-source' };
    }
    if (typeof p.finding !== 'string' || p.finding.length < 60 || p.finding.length > 400) {
      return { enabled: false, reason: 'bad-finding' };
    }
  }

  // Even when the file is well-formed, automation is not authorized.
  return { enabled: false, reason: 'automation-not-authorized' };
}

/** A provider is enabled only if policy says permitted AND approved. Never true today. */
export function isProviderEnabled(entry: ProviderPolicyEntry): boolean {
  return entry.decision === 'permitted' && entry.approved === true;
}
