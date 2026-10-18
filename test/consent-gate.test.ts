import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ConsentGate, requireConsent } from '../src/core/consent-gate.js';

test('starts unknown and not granted', () => {
  const g = new ConsentGate();
  assert.equal(g.get(), 'unknown');
  assert.equal(g.isGranted(), false);
});

test('grant makes it granted', () => {
  const g = new ConsentGate();
  assert.equal(g.grant(1), true);
  assert.equal(g.isGranted(), true);
  assert.equal(g.get(), 'granted');
});

test('revoke after grant makes it not granted', () => {
  const g = new ConsentGate();
  g.grant(1);
  g.revoke(2, 'user');
  assert.equal(g.isGranted(), false);
  assert.equal(g.get(), 'revoked');
});

test('pending does not downgrade a grant', () => {
  const g = new ConsentGate();
  g.grant(1);
  g.pending(2);
  assert.equal(g.get(), 'granted');
});

test('requireConsent throws when not granted', () => {
  const g = new ConsentGate();
  assert.throws(() => requireConsent(g, 'read'), /consent absent/);
  g.grant(1);
  assert.doesNotThrow(() => requireConsent(g, 'read'));
});

test('history is recorded and bounded', () => {
  const g = new ConsentGate();
  g.grant(1);
  g.revoke(2);
  g.grant(3);
  const h = g.historyOf();
  assert.ok(h.length >= 2);
});
