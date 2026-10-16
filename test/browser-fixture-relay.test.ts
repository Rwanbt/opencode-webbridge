import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import { browserFixtureResponder } from '../src/testing/browser-fixture-relay.js';
import { openFixtureServer } from '../src/testing/fixture-inference.js';
import type { TabClaim } from '../src/core/browser-port.js';

const binding: TabClaim = { sessionID: 'fixture', providerID: 'chatgpt', tabID: 'fixture-tab', accountRef: 'fake-account' };

test('OpenAI-compatible mock HTTP route forwards an actual user prompt to BrowserPort', async () => {
  const browser = new FakeBrowserPort((text) => `browser-fixture:${text}`);
  await browser.claim(binding);
  const server = await openFixtureServer({ respond: browserFixtureResponder(browser, binding) });
  try {
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'webbridge-native-fixture', stream: true, messages: [
        { role: 'system', content: 'not the prompt' }, { role: 'user', content: 'hello from OpenCode' },
      ] }),
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /browser-fixture:hello from OpenCode/);
    assert.equal(server.requests(), 1);
  } finally { await server.close(); await browser.release(binding); }
});

test('bridge returns generic 503 on invalid messages and never leaks session data', async () => {
  const browser = new FakeBrowserPort();
  await browser.claim(binding);
  const server = await openFixtureServer({ respond: browserFixtureResponder(browser, binding) });
  try {
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'webbridge-native-fixture', messages: [{ role: 'user', content: '' }] }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { message: 'fixture response unavailable' } });
    await browser.release(binding);
    const missing = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'webbridge-native-fixture', messages: [{ role: 'user', content: 'hello' }] }),
    });
    assert.equal(missing.status, 503);
  } finally { await server.close(); }
});
