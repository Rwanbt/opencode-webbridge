import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validateAdapterContract, isAdapterUsable } from '../src/core/adapter-contract.js';

const valid = {
  identity: { providerID: 'qwen', displayName: 'Qwen', origin: 'https://chat.qwen.ai' },
  capabilities: { textInput: 'supported', textOutput: 'supported', streaming: 'supported', tools: 'unsupported', attachments: 'unknown', interruption: 'supported' },
  verifiedCapabilities: null,
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

test('isAdapterUsable requires verified capabilities, with no other gate', () => {
  // A claim of approval alone never activates anything.
  const claim = JSON.parse(JSON.stringify(valid));
  claim.approved = true;
  assert.deepEqual(validateAdapterContract(claim), { ok: true });
  assert.equal(isAdapterUsable(claim), false);
  claim.verifiedCapabilities = { ...claim.capabilities };
  assert.equal(isAdapterUsable(claim), true);

  // Declared and verified capabilities must both hold per core capability.
  const weak = JSON.parse(JSON.stringify(claim));
  weak.capabilities.streaming = 'unknown';
  assert.equal(isAdapterUsable(weak), false);
  weak.capabilities.streaming = 'supported';
  weak.verifiedCapabilities.streaming = 'unknown';
  assert.equal(isAdapterUsable(weak), false);

  const notApproved = JSON.parse(JSON.stringify(claim));
  notApproved.approved = false;
  assert.equal(isAdapterUsable(notApproved), false);
});
