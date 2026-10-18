import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateGate, initialGates, type ProviderGate } from '../src/core/provider-gate.js';

const granted: ProviderGate = {
  id: 'chatgpt', policy: 'permitted', transport: 'verified', browser: 'verified',
  authenticated: true, consented: true, textInput: 'supported', textOutput: 'supported',
  tools: 'unknown', streaming: 'unknown',
};

test('all five providers fail closed on startup', () => {
  const gates = initialGates();
  assert.equal(gates.size, 5);
  for (const gate of gates.values()) assert.deepEqual(evaluateGate(gate), { ready: false, reason: 'policy' });
});

test('each necessary gate blocks independently when missing', () => {
  assert.deepEqual(evaluateGate(granted), { ready: true });
  for (const [key, value, reason] of [
    ['policy', 'unreviewed', 'policy'], ['policy', 'prohibited', 'policy'],
    ['transport', 'fixture-only', 'transport'], ['browser', 'unproven', 'browser'],
    ['authenticated', false, 'auth'], ['consented', false, 'consent'],
    ['textInput', 'unknown', 'capability'], ['textOutput', 'unsupported', 'capability'],
  ] as const) {
    assert.deepEqual(evaluateGate({ ...granted, [key]: value }), { ready: false, reason });
  }
});
