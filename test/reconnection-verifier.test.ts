import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ReconnectionVerifier } from '../src/core/reconnection-verifier.js';

const conn = { connectionID: 'c1', connectionGeneration: 'g1', pluginID: 'p', pluginGeneration: 'pg', sessionID: 's' };

test('verify without prior connection fails', () => {
  const v = new ReconnectionVerifier();
  const r = v.verify(conn, 100, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-prior-connection');
});

test('matching connection verifies ok within age', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  const r = v.verify(conn, 500, 1000);
  assert.deepEqual(r, { ok: true });
});

test('stale connection (too old) is rejected', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  const r = v.verify(conn, 2000, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'stale');
});

test('generation mismatch is rejected', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  const r = v.verify({ ...conn, connectionGeneration: 'g2' }, 100, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'generation-mismatch');
});

test('session mismatch is rejected', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  const r = v.verify({ ...conn, sessionID: 'other' }, 100, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'session-mismatch');
});

test('plugin mismatch is rejected', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  const r = v.verify({ ...conn, pluginID: 'other' }, 100, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'plugin-mismatch');
});

test('clear removes prior connection', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 0);
  v.clear();
  const r = v.verify(conn, 100, 1000);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-prior-connection');
});

test('a missing or invalid identity cannot bootstrap a verified reconnection', () => {
  const v = new ReconnectionVerifier();
  assert.throws(() => v.record({ ...conn, pluginID: '' }, 100), /invalid/);
  assert.throws(() => v.record({ ...conn, sessionID: 'bad id' }, 100), /invalid/);
  assert.throws(() => v.record(conn, -1), /timestamp/);
  assert.equal(v.hasPrior(), false);
  v.record(conn, 100);
  assert.deepEqual(v.verify({ ...conn, pluginGeneration: '' }, 110, 1000),
    { ok: false, reason: 'invalid-input' });
});

test('malformed time windows and unexpected extra fields cannot authorize stale connection', () => {
  const v = new ReconnectionVerifier();
  v.record(conn, 100);
  for (const [now, age] of [[-1, 1000], [200, -1], [200, NaN], [NaN, 1000], [200, Infinity]]) {
    assert.deepEqual(v.verify(conn, now, age), { ok: false, reason: 'invalid-input' });
  }
  assert.deepEqual(v.verify({ ...conn, cookie: 'injected' } as never, 120, 1000),
    { ok: false, reason: 'invalid-input' });
});

test('record and verify never execute JavaScript getters from untrusted identity objects', () => {
  const v = new ReconnectionVerifier();
  let reads = 0;
  const forged = { ...conn };
  Object.defineProperty(forged, 'pluginID', { enumerable: true, get() { reads++; return 'p'; } });
  assert.throws(() => v.record(forged, 100), /plain|data|invalid/);
  assert.equal(reads, 0);
  v.record(conn, 100);
  assert.deepEqual(v.verify(forged, 150, 1000), { ok: false, reason: 'invalid-input' });
  assert.equal(reads, 0);
});
