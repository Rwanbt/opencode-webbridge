/**
 * Bounded rate limiter / quota guard for WebBridge operations.
 *
 * Tracks per-key counts within a sliding window and a global concurrency cap.
 * Fail-closed: exceeding any limit denies the operation.
 */

export interface RateLimitConfig {
  readonly maxPerWindow: number;
  readonly windowMs: number;
  readonly maxConcurrency: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly reason?: 'rate-exceeded' | 'concurrency-exceeded' | 'invalid-key';
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private concurrency = 0;

  constructor(private readonly config: RateLimitConfig) {
    if (config.maxPerWindow < 1 || config.windowMs < 1 || config.maxConcurrency < 1) {
      throw new Error('invalid rate limit config');
    }
  }

  /** Try to acquire a slot for key. Returns allowed + release function. */
  acquire(key: string, now: number): { allowed: boolean; reason?: string; release: () => void } {
    if (typeof key !== 'string' || key.length === 0 || key.length > 128) {
      return { allowed: false, reason: 'invalid-key', release: () => {} };
    }
    if (!Number.isSafeInteger(now) || now < 0) {
      return { allowed: false, reason: 'invalid-key', release: () => {} };
    }
    if (this.concurrency >= this.config.maxConcurrency) {
      return { allowed: false, reason: 'concurrency-exceeded', release: () => {} };
    }

    const cutoff = now - this.config.windowMs;
    const arr = (this.windows.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.config.maxPerWindow) {
      this.windows.set(key, arr);
      return { allowed: false, reason: 'rate-exceeded', release: () => {} };
    }
    arr.push(now);
    this.windows.set(key, arr);
    this.concurrency += 1;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (this.concurrency > 0) this.concurrency -= 1;
    };
    return { allowed: true, release };
  }

  /** Current concurrency. */
  currentConcurrency(): number { return this.concurrency; }

  /** Reset all state. */
  reset(): void {
    this.windows.clear();
    this.concurrency = 0;
  }
}
