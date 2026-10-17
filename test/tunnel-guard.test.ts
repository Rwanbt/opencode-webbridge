import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateTunnelTarget } from '../src/core/tunnel-guard.js';

test('approved loopback target passes', () => {
  const r = validateTunnelTarget({ host: '127.0.0.1', port: 8765, protocol: 'http' });
  assert.deepEqual(r, { ok: true });
});

test('localhost passes', () => {
  const r = validateTunnelTarget({ host: 'localhost', port: 8787, protocol: 'ws' });
  assert.deepEqual(r, { ok: true });
});

test('non-approved port rejected', () => {
  const r = validateTunnelTarget({ host: '127.0.0.1', port: 80, protocol: 'http' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-port');
});

test('non-loopback host rejected', () => {
  const r = validateTunnelTarget({ host: 'example.com', port: 8765, protocol: 'http' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'non-loopback');
});

test('private range rejected', () => {
  const r = validateTunnelTarget({ host: '192.168.1.1', port: 8765, protocol: 'http' });
  assert.equal(r.ok, false);
});

test('credential-bearing host rejected', () => {
  const r = validateTunnelTarget({ host: 'user:pass@127.0.0.1', port: 8765, protocol: 'http' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'credential-bearing');
});

test('bad protocol rejected', () => {
  const r = validateTunnelTarget({ host: '127.0.0.1', port: 8765, protocol: 'ftp' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-protocol');
});

test('non-object rejected', () => {
  const r = validateTunnelTarget(null);
  assert.equal(r.ok, false);
});
