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

test('latest user multimodal request cannot fall back to an earlier text message', async () => {
  let sends = 0;
  const browser = new FakeBrowserPort((text) => { sends++; return `fixture:${text}`; });
  await browser.claim(binding);
  try {
    const reply = browserFixtureResponder(browser, binding);
    await assert.rejects(reply([
      { role: 'user', content: 'outdated plain text' },
      { role: 'assistant', content: 'prior reply' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'file:///private' } }] },
    ]), /unsupported|bounded|text/i);
    assert.equal(sends, 0);
  } finally { await browser.release(binding); }
});

test('message role and content accessors never run while choosing the latest user turn', async () => {
  let effects = 0;
  const browser = new FakeBrowserPort((text) => { effects++; return text; });
  await browser.claim(binding);
  const respond = browserFixtureResponder(browser, binding);
  let getters = 0;
  const roleGetter = Object.defineProperty({ content: 'injected command' }, 'role', {
    enumerable: true, get() { getters++; return 'user'; },
  });
  const contentGetter = Object.defineProperty({ role: 'user' }, 'content', {
    enumerable: true, get() { getters++; return 'secret prompt'; },
  });
  try {
    for (const input of [roleGetter, contentGetter]) {
      await assert.rejects(respond([
        { role: 'user', content: 'old approved prompt' }, input,
      ]), /unsupported|plain|role|content/i);
    }
    assert.equal(getters, 0, 'untrusted accessors must not execute during message selection');
    assert.equal(effects, 0, 'no fallback or unintended browser send');
  } finally { await browser.release(binding); }
});
