import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RateLimiter } from '../src/core/rate-limiter.js';

const cfg = { maxPerWindow: 2, windowMs: 1000, maxConcurrency: 1 };

test('allows first two calls within window', () => {
  const rl = new RateLimiter(cfg);
  const a = rl.acquire('k', 1); a.release();
  const b = rl.acquire('k', 2); b.release();
  assert.equal(rl.currentConcurrency(), 0);
});

test('rate exceeded returns false', () => {
  const rl = new RateLimiter(cfg);
  const a = rl.acquire('k', 1); a.release();
  const b = rl.acquire('k', 2); b.release();
  const c = rl.acquire('k', 3);
  assert.equal(c.allowed, false);
  if (!c.allowed) assert.equal(c.reason, 'rate-exceeded');
  c.release();
});

test('window slides allows after expiry', () => {
  const rl = new RateLimiter(cfg);
  const a = rl.acquire('k', 1); a.release();
  const b = rl.acquire('k', 2); b.release();
  const c = rl.acquire('k', 1002);
  assert.equal(c.allowed, true);
  c.release();
});

test('concurrency cap enforced', () => {
  const rl = new RateLimiter(cfg);
  const a = rl.acquire('k', 1);
  assert.equal(a.allowed, true);
  const b = rl.acquire('k', 2);
  assert.equal(b.allowed, false);
  if (!b.allowed) assert.equal(b.reason, 'concurrency-exceeded');
  a.release();
  const c = rl.acquire('k', 3);
  assert.equal(c.allowed, true);
  c.release();
});

test('invalid key rejected', () => {
  const rl = new RateLimiter(cfg);
  const r = rl.acquire('', 1);
  assert.equal(r.allowed, false);
  if (!r.allowed) assert.equal(r.reason, 'invalid-key');
});

test('release is idempotent', () => {
  const rl = new RateLimiter(cfg);
  const a = rl.acquire('k', 1);
  a.release();
  a.release();
  assert.equal(rl.currentConcurrency(), 0);
});

test('NaN, Infinity, fractional and unbounded quotas never disable admission caps', () => {
  for (const field of ['maxPerWindow', 'windowMs', 'maxConcurrency'] as const) {
    for (const bad of [NaN, Infinity, -Infinity, 1.5, 0]) {
      assert.throws(() => new RateLimiter({ ...cfg, [field]: bad }), /invalid rate limit config/);
    }
  }
  assert.throws(() => new RateLimiter({ ...cfg, maxConcurrency: 100_000 }), /invalid/);
});

test('caller cannot mutate live limiter configuration after construction', () => {
  const config = { ...cfg };
  const limiter = new RateLimiter(config);
  config.maxConcurrency = 9999;
  const first = limiter.acquire('a', 1);
  assert.equal(first.allowed, true);
  assert.equal(limiter.acquire('b', 2).allowed, false);
  first.release();
});

test('reset cannot release an existing active lease or permit accidental overlap', () => {
  const rl = new RateLimiter(cfg);
  const first = rl.acquire('first', 10);
  assert.equal(first.allowed, true);
  assert.throws(() => rl.reset(), /active|lease/);
  assert.equal(rl.currentConcurrency(), 1);
  const blocked = rl.acquire('second', 11);
  assert.equal(blocked.allowed, false);
  first.release();
  rl.reset();
  assert.equal(rl.acquire('second', 12).allowed, true);
});

test('backwards clock never clears quota bookkeeping or admits a new operation', () => {
  const rl = new RateLimiter(cfg);
  const first = rl.acquire('k', 100);
  first.release();
  const rollback = rl.acquire('k', 99);
  assert.equal(rollback.allowed, false);
  assert.equal(rollback.reason, 'clock-regression');
  assert.equal(rl.acquire('k', 101).allowed, true);
});

test('untrusted keys and key-flood beyond a bounded catalog fail closed', () => {
  const rl = new RateLimiter({ maxPerWindow: 1, windowMs: 1000, maxConcurrency: 2 });
  for (const bad of ['a\n', 'a b', '../other', 'k?secret=token', 'ø']) {
    assert.equal(rl.acquire(bad, 1).allowed, false, bad);
  }
  for (let i = 0; i < 1024; i++) {
    const slot = rl.acquire(`key_${i}`, 10);
    assert.equal(slot.allowed, true, String(i));
    slot.release();
  }
  const overflow = rl.acquire('overflow', 10);
  assert.equal(overflow.allowed, false);
  assert.equal(overflow.reason, 'key-capacity');
  const recovered = rl.acquire('overflow', 1011);
  assert.equal(recovered.allowed, true); // old windows expired and can be pruned
  recovered.release();
});
