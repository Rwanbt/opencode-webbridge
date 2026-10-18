import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { canTransition, transitionEffect, isTerminal, isUncertain, requiresReconciliation, isRetrySafe, type EffectRecord } from '../src/core/effect-transaction.js';

function rec(phase: any): EffectRecord {
  return { effectID: 'e1', phase, principal: 'p', action: 'read', createdAt: 1, updatedAt: 1 };
}

test('happy path authorized->prepared->consumed->committed->confirmed', () => {
  let r: any = rec('authorized');
  for (const next of ['prepared', 'consumed', 'committed', 'confirmed'] as const) {
    const res = transitionEffect(r, next, 2);
    assert.equal(res.ok, true);
    r = res.record;
  }
  assert.equal(r.phase, 'confirmed');
});

test('committed can become uncertain', () => {
  const r = rec('committed');
  const res = transitionEffect(r, 'uncertain', 2);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.record?.phase, 'uncertain');
});

test('confirmed cannot become uncertain', () => {
  const r = rec('confirmed');
  const res = transitionEffect(r, 'uncertain', 2);
  assert.equal(res.ok, false);
});

test('uncertain can only be reconciled', () => {
  const r = rec('uncertain');
  assert.equal(transitionEffect(r, 'reconciled', 2).ok, true);
  assert.equal(transitionEffect(r, 'confirmed', 2).ok, false);
});

test('prepared cannot skip to committed', () => {
  const r = rec('prepared');
  assert.equal(transitionEffect(r, 'committed', 2).ok, false);
});

test('retry safety: only authorized is retry-safe', () => {
  assert.equal(isRetrySafe('authorized'), true);
  for (const p of ['prepared', 'consumed', 'committed', 'uncertain'] as const) {
    assert.equal(isRetrySafe(p), false, p);
  }
});

test('uncertain requires reconciliation', () => {
  assert.equal(requiresReconciliation('uncertain'), true);
  assert.equal(requiresReconciliation('confirmed'), false);
});

test('terminal states', () => {
  assert.equal(isTerminal('confirmed'), true);
  assert.equal(isTerminal('uncertain'), true);
  assert.equal(isTerminal('reconciled'), true);
  assert.equal(isTerminal('committed'), false);
});
