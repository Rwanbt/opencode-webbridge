import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateProviderPolicy, isProviderEnabled } from '../src/core/provider-policy.js';
import policy from '../planning/provider-policy-review.json' with { type: 'json' };

test('real policy file keeps automation disabled', () => {
  const r = validateProviderPolicy(policy);
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'no-provider-opted-in');
});

test('missing observedAt fails', () => {
  const r = validateProviderPolicy({ ...policy, observedAt: '' });
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'bad-observed-at');
});

test('legacy global commercial flag does not grant an unreviewed provider', () => {
  const r = validateProviderPolicy({ ...policy, commercialAutomationEnabled: true });
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'no-provider-opted-in');
});

test('unreviewed provider cannot be activated by user opt-in alone', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers[0].approved = true;
  const r = validateProviderPolicy(p);
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'incoherent-opt-in');
});

test('reviewed individual user choice can pass policy without any commercial approval field', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers[2].decision = 'permitted';
  p.providers[2].approved = true;
  const r = validateProviderPolicy(p);
  assert.deepEqual(r, { enabled: true, reason: 'ok' });
  assert.equal(isProviderEnabled(p.providers[2]), true);
  assert.equal(isProviderEnabled(p.providers[0]), false);
});

test('bad provider count fails', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers = p.providers.slice(0, 4);
  const r = validateProviderPolicy(p);
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'bad-provider-count');
});

test('an official source for another provider cannot be used as this provider evidence', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers[2].source = p.providers[0].source;
  assert.deepEqual(validateProviderPolicy(p), { enabled: false, reason: 'bad-source' });
});

test('isProviderEnabled is false for all real entries', () => {
  for (const e of (policy as any).providers) {
    assert.equal(isProviderEnabled(e), false);
  }
});
