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
