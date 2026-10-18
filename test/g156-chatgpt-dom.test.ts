import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { chromium } from 'playwright';
import {
  G156ChatgptObserver, g156Origin, type G156Attachment, type G156Tab,
  type G156Observation,
} from '../src/providers/g156-chatgpt-dom.js';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';

const original: G156Tab = { tabID: 'attachedTab', generation: 'gen1',
  url: 'https://chatgpt.com/c/fixture' };
const answer: G156Observation = { messageKey: 'msg-1', layout: 'legacy', text: 'Hello', finalized: false };
function fixture(initial: G156Observation | null = answer) {
  let tab: G156Tab = { ...original };
  let response = initial;
  let permitted = true, evaluated = 0;
  const host: G156Attachment = {
    current: async () => tab,
    evaluate: async () => { evaluated++; return response as never; },
    authorizeRead: async () => { if (!permitted) throw new Error('host permission revoked'); },
  };
  return { host, setTab: (value: G156Tab) => { tab = value; },
    setResponse: (value: G156Observation | null) => { response = value; },
    revoke: () => { permitted = false; }, reads: () => evaluated };
}

test('G156 official HTTPS origins for all five providers, no redirects/lookalikes', () => {
  for (const provider of WEB_PROVIDER_CATALOG) {
    assert.equal(g156Origin(provider.id, provider.origin + '/c/local'), provider.origin);
    for (const bad of ['http://' + new URL(provider.origin).host + '/',
      provider.origin + '.evil.test/', provider.origin.replace('https://', 'https://user:pass@'),
      provider.origin.replace('https://', 'https://') + ':444/', 'https://localhost/']) {
      assert.throws(() => g156Origin(provider.id, bad), /denied|invalid/);
    }
  }
  assert.throws(() => g156Origin('not-provider' as never, original.url), /unknown/);
});

test('G156 attached ChatGPT streams only selected assistant DOM deltas', async () => {
  const local = fixture();
  const observer = await G156ChatgptObserver.attach(local.host, 'chatgpt', original);
  const collected: string[] = [];
  let pauses = 0;
  for await (const event of observer.observe('readTurn', 'msg-1', {
    polls: 3, pause: async () => {
      pauses++;
      local.setResponse({ ...answer, text: pauses === 1 ? 'Hello world' : 'Hello world!' });
    },
  })) {
    assert.equal(event.kind, 'text');
    if (event.kind === 'text') collected.push(event.value);
  }
  assert.deepEqual(collected, ['Hello', ' world', '!']);
  assert.equal(local.reads(), 3);
});

test('G156 wrong provider, missing or changed message, mutation and origin denied', async () => {
  const local = fixture();
  await assert.rejects(G156ChatgptObserver.attach(local.host, 'gemini', original), /unavailable/);
  const observer = await G156ChatgptObserver.attach(local.host, 'chatgpt', original);
  await assert.rejects(async () => {
    for await (const _ of observer.observe('t1', 'anotherKey', { polls: 1 })) void _;
  }, /disappeared/);
  local.setResponse({ ...answer, text: 'Hello!' });
  await assert.rejects(async () => {
    for await (const _ of observer.observe('t1', 'msg-1', {
      polls: 2, pause: async () => local.setResponse({ ...answer, text: 'Rewritten' }),
    })) void _;
  }, /rewritten/);
  local.setTab({ ...original, url: 'https://chatgpt.com.evil.invalid/c/fixture' });
  await assert.rejects(observer.sample(), /changed/);
});

test('G156 navigation and revoked authorization during awaited DOM read drop output', async () => {
  const local = fixture();
  const observer = await G156ChatgptObserver.attach(local.host, 'chatgpt', original);
  const changed: G156Attachment = {
    ...local.host, evaluate: async () => {
      local.setTab({ ...original, generation: 'gen2' });
      return answer as never;
    },
  };
  const other = await G156ChatgptObserver.attach(changed, 'chatgpt', original);
  await assert.rejects(other.sample(), /changed/);
  local.setTab(original);
  local.revoke();
  await assert.rejects(observer.sample(), /revoked/);
  assert.equal(local.reads(), 0);
});

test('G156 hostile tab metadata and DOM getters rejected without executing', async () => {
  let called = 0;
  const hostileTab = { ...original, get generation() { called++; return 'gen1'; } };
  const first = fixture();
  await assert.rejects(G156ChatgptObserver.attach({ ...first.host,
    current: async () => hostileTab }, 'chatgpt', original), /accessor|denied/);
  assert.equal(called, 0);
  const raw: G156Attachment = { ...first.host, evaluate: async () => ({
    messageKey: 'msg-1', layout: 'legacy',
    get text() { called++; return 'secret'; },
  }) as never };
  const observer = await G156ChatgptObserver.attach(raw, 'chatgpt', original);
  await assert.rejects(observer.sample(), /malformed/);
  assert.equal(called, 0);
});

test('G156 real Chromium DOM legacy + 2026 Chat/Work emulation, read-only', {
  skip: process.env.WEBBRIDGE_G156_BROWSER !== '1',
}, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ serviceWorkers: 'block', acceptDownloads: false });
    const legacy = '<article data-turn="assistant" data-turn-id="old-1"><div data-message-author-role="assistant"><div class="markdown">Alpha</div></div></article>';
    const modern = '<section data-turn-key="turn1"><div data-content-search-unit-key="turn1:0:assistant"><div data-markdown-text-style="assistant-message">New</div></div><div data-content-search-unit-key="turn1:0:user"><div data-user-message-bubble="true">PRIVATE_USER</div></div></section>';
    let html = legacy;
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html', body: html,
    }));
    await page.goto(original.url, { waitUntil: 'domcontentloaded' });
    let authorized = 0;
    const attached: G156Attachment = {
      current: async () => ({ ...original, url: page.url() }),
      authorizeRead: async () => { authorized++; },
      evaluate: async (fn) => page.evaluate(fn),
    };
    const observer = await G156ChatgptObserver.attach(attached, 'chatgpt', original);
    assert.deepEqual(await observer.sample(), {
      messageKey: 'old-1', text: 'Alpha', layout: 'legacy', finalized: false,
    });
    html = modern;
    await page.reload();
    assert.deepEqual(await observer.sample(), {
      messageKey: 'turn1:0:assistant', text: 'New', layout: 'work', finalized: false,
    });
    const parts: string[] = [];
    for await (const event of observer.observe('turnRead', 'turn1:0:assistant', {
      polls: 2, pause: async () => { await page.locator(
        '[data-markdown-text-style="assistant-message"]').evaluate((el) => { el.textContent = 'New text'; }); },
    })) if (event.kind === 'text') parts.push(event.value);
    assert.deepEqual(parts, ['New', ' text']);
    assert.ok(authorized >= 8);
    assert.equal(await page.locator('[data-user-message-bubble]').textContent(), 'PRIVATE_USER');
  } finally { await browser.close(); }
});
