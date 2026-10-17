import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import { browserFixtureResponder, browserFixtureStreamResponder } from '../src/testing/browser-fixture-relay.js';
import { openFixtureServer } from '../src/testing/fixture-inference.js';
import type { BrowserPort, TabClaim } from '../src/core/browser-port.js';

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

test('HTTP client disconnect interrupts a pending browser event poll without replaying the turn', async () => {
  let sends = 0;
  let polls = 0;
  let cancelAttempts = 0;
  let turnID = '';
  const port = {
    submit: async (_binding: TabClaim, request: { turnID: string }) => { sends++; turnID = request.turnID; },
    events: async () => {
      polls++;
      if (polls === 1) return [{ seq: 1, kind: 'text', turnID, value: 'first-delta' }];
      return new Promise<never>(() => {});
    },
    cancel: async () => { cancelAttempts++; return false; },
  } as unknown as BrowserPort;
  const server = await openFixtureServer({ respond: browserFixtureStreamResponder(port, binding) });
  try {
    const abort = new AbortController();
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
      body: JSON.stringify({ model: 'webbridge-native-fixture', stream: true,
        messages: [{ role: 'user', content: 'abort during pending browser poll' }] }),
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    assert.match(new TextDecoder().decode((await reader.read()).value), /first-delta/);
    abort.abort();
    await assert.rejects(reader.read());
    for (let i = 0; i < 20 && cancelAttempts === 0; i++) {
      await new Promise<void>((done) => setTimeout(done, 20));
    }
    assert.equal(cancelAttempts, 1, 'upstream abort must attempt best-effort cancellation promptly');
    assert.equal(sends, 1, 'never replay a potentially dispatched browser turn');
    assert.equal(server.streamFrames(), 1, 'never send further deltas or a misleading terminal');
  } finally { await server.close(); }
});
