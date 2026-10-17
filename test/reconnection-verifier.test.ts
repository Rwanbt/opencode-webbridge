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
