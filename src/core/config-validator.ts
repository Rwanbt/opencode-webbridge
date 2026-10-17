/**
 * Validated local configuration for WebBridge.
 *
 * Fail-closed: any invalid or missing required field disables the feature.
 * No global OpenCode config or credentials are touched.
 */

export interface WebBridgeConfig {
  readonly enabled: boolean;
  readonly providers: readonly string[];
  readonly maxConcurrency: number;
  readonly requestTimeoutMs: number;
  readonly logLevel: 'silent' | 'error' | 'info' | 'debug';
}

export type ConfigResult =
  | { readonly ok: true; readonly config: WebBridgeConfig }
  | { readonly ok: false; readonly reason: string };

const ALLOWED_LOG = new Set(['silent', 'error', 'info', 'debug']);
const ALL_PROVIDERS = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];

export function validateConfig(raw: unknown): ConfigResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'config must be an object' };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.enabled !== 'boolean') return { ok: false, reason: 'enabled must be boolean' };

  if (!Array.isArray(r.providers)) return { ok: false, reason: 'providers must be array' };
  for (const p of r.providers) {
    if (typeof p !== 'string' || !ALL_PROVIDERS.includes(p)) {
      return { ok: false, reason: `unknown provider: ${String(p)}` };
    }
  }

  if (typeof r.maxConcurrency !== 'number' || !Number.isSafeInteger(r.maxConcurrency) ||
      r.maxConcurrency < 1 || r.maxConcurrency > 16) {
    return { ok: false, reason: 'maxConcurrency out of bounds (1..16)' };
  }
  if (typeof r.requestTimeoutMs !== 'number' || !Number.isSafeInteger(r.requestTimeoutMs) ||
      r.requestTimeoutMs < 1000 || r.requestTimeoutMs > 300000) {
    return { ok: false, reason: 'requestTimeoutMs out of bounds (1000..300000)' };
  }
  if (typeof r.logLevel !== 'string' || !ALLOWED_LOG.has(r.logLevel)) {
    return { ok: false, reason: 'invalid logLevel' };
  }

  return {
    ok: true,
    config: {
      enabled: r.enabled,
      providers: Object.freeze([...r.providers] as string[]),
      maxConcurrency: r.maxConcurrency,
      requestTimeoutMs: r.requestTimeoutMs,
      logLevel: r.logLevel as WebBridgeConfig['logLevel'],
    },
  };
}

export function defaultConfig(): WebBridgeConfig {
  return Object.freeze({
    enabled: false,
    providers: Object.freeze([]),
    maxConcurrency: 1,
    requestTimeoutMs: 30000,
    logLevel: 'error',
  });
}
