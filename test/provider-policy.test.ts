import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateProviderPolicy, isProviderEnabled } from '../src/core/provider-policy.js';
import policy from '../planning/provider-policy-review.json' with { type: 'json' };

test('real policy file keeps automation disabled', () => {
  const r = validateProviderPolicy(policy);
  assert.equal(r.enabled, false);
  // well-formed but not authorized
  assert.equal(r.reason, 'automation-not-authorized');
});

test('missing observedAt fails', () => {
  const r = validateProviderPolicy({ ...policy, observedAt: '2020-01-01' });
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'bad-observed-at');
});

test('automation enabled fails', () => {
  const r = validateProviderPolicy({ ...policy, commercialAutomationEnabled: true });
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'automation-not-authorized');
});

test('approved provider fails', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers[0].approved = true;
  const r = validateProviderPolicy(p);
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'unapproved');
});

test('bad provider count fails', () => {
  const p = JSON.parse(JSON.stringify(policy));
  p.providers = p.providers.slice(0, 4);
  const r = validateProviderPolicy(p);
  assert.equal(r.enabled, false);
  assert.equal(r.reason, 'bad-provider-count');
});

test('isProviderEnabled is false for all real entries', () => {
  for (const e of (policy as any).providers) {
    assert.equal(isProviderEnabled(e), false);
  }
});
