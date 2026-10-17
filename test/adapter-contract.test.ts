import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateAdapterContract, isAdapterUsable } from '../src/core/adapter-contract.js';

const valid = {
  identity: { providerID: 'qwen', displayName: 'Qwen', origin: 'https://chat.qwen.ai' },
  capabilities: { textInput: 'supported', textOutput: 'supported', streaming: 'supported', tools: 'unsupported', attachments: 'unknown', interruption: 'supported' },
  policyDecision: 'restricted',
  approved: false,
};

test('valid contract passes', () => {
  assert.deepEqual(validateAdapterContract(valid), { ok: true });
});

test('unknown provider fails', () => {
  const c = JSON.parse(JSON.stringify(valid));
  c.identity.providerID = 'foo';
  const r = validateAdapterContract(c);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'unknown-provider');
});

test('bad origin fails', () => {
  const c = JSON.parse(JSON.stringify(valid));
  c.identity.origin = 'http://x.com';
  const r = validateAdapterContract(c);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-origin');
});

test('bad capability fails', () => {
  const c = JSON.parse(JSON.stringify(valid));
  c.capabilities.streaming = 'maybe';
  const r = validateAdapterContract(c);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'bad-capability:streaming');
});

test('isAdapterUsable false when not approved', () => {
  const c = valid as any;
  assert.equal(isAdapterUsable(c), false);
});

test('isAdapterUsable true only when all core supported and approved', () => {
  const c = JSON.parse(JSON.stringify(valid));
  c.approved = true;
  assert.equal(isAdapterUsable(c), true);
  c.capabilities.streaming = 'unknown';
  assert.equal(isAdapterUsable(c), false);
});
