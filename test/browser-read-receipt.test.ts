import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  isWellFormed, verifyReadReceipt, ReceiptRegistry, type BrowserReadBinding, type BrowserReadReceipt,
} from '../src/core/browser-read-receipt.js';

const binding: BrowserReadBinding = {
  pluginID: 'opencode-webbridge', pluginGeneration: 'g1', sessionID: 'sess-r',
  workspaceID: 'ws-1', turnID: 'turn-r', callID: 'call-r', connectionID: 'conn-r',
  connectionGeneration: 'cg-1', tabID: 'tab-r', tabGeneration: 'tg-1', action: 'browser.read',
  permissionRevision: 'pr-1', policyEpoch: 'pe-1',
};

function makeReceipt(overrides: Partial<BrowserReadReceipt> = {}): BrowserReadReceipt {
  return {
    ...binding,
    ticketNonce: 'nonce-ABCDEFGHIJKLMNOPQRSTUV',
    issuedAt: 1000,
    expiresAt: 2000,
    ...overrides,
  };
}

test('well-formed receipt passes structural check', () => {
  assert.equal(isWellFormed(makeReceipt()), true);
});

test('malformed receipt fails structural check', () => {
  assert.equal(isWellFormed(null), false);
  assert.equal(isWellFormed({}), false);
  assert.equal(isWellFormed(makeReceipt({ ticketNonce: 'short' })), false);
  assert.equal(isWellFormed(makeReceipt({ expiresAt: 1000 })), false); // not > issuedAt
});

test('valid receipt verifies ok', () => {
  const reg = new ReceiptRegistry();
  const res = verifyReadReceipt(makeReceipt(), { binding, now: 1500, registry: reg });
  assert.deepEqual(res, { ok: true });
});

test('expired receipt is rejected', () => {
  const reg = new ReceiptRegistry();
  const res = verifyReadReceipt(makeReceipt(), { binding, now: 2000, registry: reg });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'expired');
});

test('not-yet-valid receipt is rejected', () => {
  const reg = new ReceiptRegistry();
  const res = verifyReadReceipt(makeReceipt(), { binding, now: 500, registry: reg });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not-yet-valid');
});

test('binding mismatch is rejected', () => {
  const reg = new ReceiptRegistry();
  const otherBinding = { ...binding, sessionID: 'sess-other' };
  const res = verifyReadReceipt(makeReceipt(), { binding: otherBinding, now: 1500, registry: reg });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'binding-mismatch');
});

test('replayed nonce is rejected', () => {
  const reg = new ReceiptRegistry();
  assert.deepEqual(verifyReadReceipt(makeReceipt(), { binding, now: 1500, registry: reg }), { ok: true });
  const res = verifyReadReceipt(makeReceipt(), { binding, now: 1500, registry: reg });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'replayed');
});

test('missing fields fail closed', () => {
  const reg = new ReceiptRegistry();
  const res = verifyReadReceipt({ foo: 'bar' }, { binding, now: 1500, registry: reg });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'missing-field');
});

test('registry consume is single-use', () => {
  const reg = new ReceiptRegistry();
  assert.equal(reg.consume('nonce-ABCDEFGHIJKLMNOPQRSTUV'), true);
  assert.equal(reg.consume('nonce-ABCDEFGHIJKLMNOPQRSTUV'), false);
  assert.equal(reg.consume('short'), false);
});
