import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { openFixtureServer } from '../src/testing/fixture-inference.js';

test('token-protected local transport rejects missing and incorrect credentials', async () => {
  const token = randomBytes(32).toString('hex');
  const server = await openFixtureServer({ token });
  try {
    const url = `${server.baseURL}/chat/completions`;
    const body = JSON.stringify({ model: 'webbridge-native-fixture', messages: [{ role: 'user', content: 'hi' }] });
    for (const authorization of [undefined, 'Bearer wrong', 'Basic dXNlcjpwYXNz']) {
      const headers = { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) };
      const response = await fetch(url, { method: 'POST', headers, body });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: { message: 'unauthorized fixture request' } });
    }
    assert.equal(server.requests(), 0);
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body,
    });
    assert.equal(response.status, 200);
    assert.equal(server.requests(), 1);
  } finally { await server.close(); }
});

test('fixture rejects weak authorization secrets before binding a port', async () => {
  await assert.rejects(openFixtureServer({ token: 'not-secure' }), /256-bit/);
});
