/** Security governance applied to a native turn transport.
 *
 *  - Bounded turn budget per provider (sliding window + a concurrency lease):
 *    a runaway model loop cannot hammer an operator's browser, and a refused
 *    turn is reported as an explicit honest terminal, never as an answer;
 *  - every error surfaced to the model/operator passes through the reviewed
 *    secret redactor, so a refusal message can never leak a token, cookie,
 *    credential or opaque hex secret.
 *
 *  Fail-closed by construction: an exhausted budget or an already-running turn
 *  refuses without touching the underlying transport. */
import { RateLimiter } from "../core/rate-limiter.js";
import { redactSecrets } from "../core/secret-redactor.js";
import type { NativeTurnEvent, NativeTurnRequest, NativeTurnTransport } from "./turn-transport.js";

export interface NativeGovernanceConfig {
  readonly maxTurnsPerWindow: number;
  readonly windowMs: number;
  readonly maxConcurrentTurns: number;
  readonly now?: () => number;
}

export const NATIVE_GOVERNANCE_DEFAULTS: NativeGovernanceConfig = Object.freeze({
  maxTurnsPerWindow: 30, windowMs: 60_000, maxConcurrentTurns: 1,
});

const LIMIT_KEY = "native-turn";

/** Redact every pattern from a message before it can reach a log or a session. */
export function redactDiagnostic(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const governed = new Error(redactSecrets(message).text);
  governed.name = error instanceof Error && error.name ? error.name : "WebBridgeError";
  return governed;
}

export function governedNativeTransport(
  transport: NativeTurnTransport,
  config: NativeGovernanceConfig = NATIVE_GOVERNANCE_DEFAULTS,
): NativeTurnTransport {
  const limiter = new RateLimiter({
    maxPerWindow: config.maxTurnsPerWindow,
    windowMs: config.windowMs,
    maxConcurrency: config.maxConcurrentTurns,
  });
  const now = config.now ?? (() => Date.now());
  return Object.freeze({
    async *stream(request: NativeTurnRequest): AsyncIterable<NativeTurnEvent> {
      const lease = limiter.acquire(LIMIT_KEY, now());
      if (!lease.allowed) {
        yield { kind: "terminal", state: "uncertain", reason: "governance-" + (lease.reason ?? "refused") };
        return;
      }
      try {
        for await (const event of transport.stream(request)) yield event;
      } catch (error) {
        throw redactDiagnostic(error);
      } finally {
        lease.release();
      }
    },
  });
}
