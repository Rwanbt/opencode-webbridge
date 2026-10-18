import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { decideRecovery, isRetrySafe, isTerminal } from '../src/core/recovery-decision.js';

test('settled is terminal success and not retryable', () => {
  const d = decideRecovery('settled');
  assert.equal(d.action, 'terminal-success');
  assert.equal(d.terminal, true);
  assert.equal(d.retryAllowed, false);
  assert.equal(isTerminal('settled'), true);
  assert.equal(isRetrySafe('settled'), false);
});

test('cancelled is terminal and not retryable', () => {
  const d = decideRecovery('cancelled');
  assert.equal(d.action, 'terminal-cancelled');
  assert.equal(d.terminal, true);
  assert.equal(d.retryAllowed, false);
});

test('reconciled is terminal', () => {
  const d = decideRecovery('reconciled');
  assert.equal(d.action, 'terminal-reconciled');
  assert.equal(d.terminal, true);
});

test('prepared requires reconciliation, never retry', () => {
  const d = decideRecovery('prepared');
  assert.equal(d.action, 'reconcile-required');
  assert.equal(d.terminal, false);
  assert.equal(d.retryAllowed, false);
  assert.equal(d.requiresOperator, true);
});

test('leased requires reconciliation, never retry', () => {
  const d = decideRecovery('leased');
  assert.equal(d.action, 'reconcile-required');
  assert.equal(d.retryAllowed, false);
  assert.equal(isRetrySafe('leased'), false);
});

test('unknown phase fails closed', () => {
  const d = decideRecovery('garbage');
  assert.equal(d.action, 'unknown');
  assert.equal(d.retryAllowed, false);
  assert.equal(d.terminal, false);
  assert.equal(d.requiresOperator, true);
  assert.equal(isRetrySafe(null), false);
  assert.equal(isTerminal(undefined), false);
});
