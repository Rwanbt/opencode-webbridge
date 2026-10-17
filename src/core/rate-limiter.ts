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
  readonly reason?: 'rate-exceeded' | 'concurrency-exceeded' | 'invalid-key' |
    'clock-regression' | 'key-capacity';
}

const MAX_KEYS = 1024;
const KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private concurrency = 0;
  private lastNow = -1;
  private readonly config: Readonly<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    if (!config || typeof config !== 'object' ||
        Object.getPrototypeOf(config) !== Object.prototype ||
        Reflect.ownKeys(config).sort().join(',') !==
          'maxConcurrency,maxPerWindow,windowMs') {
      throw new Error('invalid rate limit config');
    }
    const values: Record<string, unknown> = {};
    for (const field of ['maxPerWindow', 'windowMs', 'maxConcurrency'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(config, field);
      if (!descriptor || !('value' in descriptor) || !Number.isSafeInteger(descriptor.value))
        throw new Error('invalid rate limit config');
      values[field] = descriptor.value;
    }
    if ((values.maxPerWindow as number) < 1 || (values.maxPerWindow as number) > 1000 ||
        (values.windowMs as number) < 1 || (values.windowMs as number) > 86_400_000 ||
        (values.maxConcurrency as number) < 1 || (values.maxConcurrency as number) > 256)
      throw new Error('invalid rate limit config');
    this.config = Object.freeze(values) as unknown as RateLimitConfig;
  }

  /** Try to acquire a slot for key. Returns allowed + release function. */
  acquire(key: string, now: number): RateLimitResult & { release: () => void } {
    if (typeof key !== 'string' || !KEY.test(key)) {
      return { allowed: false, reason: 'invalid-key', release: () => {} };
    }
    if (!Number.isSafeInteger(now) || now < 0) {
      return { allowed: false, reason: 'invalid-key', release: () => {} };
    }
    if (now < this.lastNow) {
      return { allowed: false, reason: 'clock-regression', release: () => {} };
    }
    this.lastNow = now;
    if (this.concurrency >= this.config.maxConcurrency) {
      return { allowed: false, reason: 'concurrency-exceeded', release: () => {} };
    }

    const cutoff = now - this.config.windowMs;
    const arr = (this.windows.get(key) ?? []).filter((t) => t > cutoff);
    if (!this.windows.has(key) && this.windows.size >= MAX_KEYS) {
      // Only expired entries may be evicted. Active rate history is never
      // silently discarded to make room for an attacker-controlled new key.
      for (const [oldKey, timestamps] of this.windows)
        if (timestamps.every((t) => t <= cutoff)) this.windows.delete(oldKey);
      if (this.windows.size >= MAX_KEYS)
        return { allowed: false, reason: 'key-capacity', release: () => {} };
    }
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
    if (this.concurrency !== 0)
      throw new Error('cannot reset rate limiter with active leases');
    this.windows.clear();
    this.lastNow = -1;
  }
}
