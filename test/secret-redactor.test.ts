import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { redactSecrets, containsSecret } from '../src/core/secret-redactor.js';

test('redacts bearer token', () => {
  const r = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
  assert.ok(!r.text.includes('abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(r.redactions >= 1);
});

test('redacts jwt', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  const r = redactSecrets(`token=${jwt}`);
  assert.ok(!r.text.includes(jwt));
});

test('redacts cookie header', () => {
  const r = redactSecrets('Cookie: session=secretvalue123');
  assert.ok(!r.text.includes('secretvalue123'));
});

test('redacts url credentials', () => {
  const r = redactSecrets('https://user:pass@example.com/path');
  assert.ok(!r.text.includes('pass'));
  assert.ok(r.text.includes('[REDACTED]'));
});

test('redacts query token', () => {
  const r = redactSecrets('https://x.com/cb?access_token=supersecret&x=1');
  assert.ok(!r.text.includes('supersecret'));
});

test('containsSecret detects', () => {
  assert.equal(containsSecret('Bearer abcdefghijklmnopqrstuvwxyz123456'), true);
  assert.equal(containsSecret('hello world'), false);
});

test('non-string safe', () => {
  assert.deepEqual(redactSecrets('' as any), { text: '', redactions: 0 } as any);
});
