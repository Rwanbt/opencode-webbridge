import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { G160OtherProviderObserver } from '../src/providers/g160-other-provider-dom.js';

const consent = (fn: () => boolean) => ({
  userDeclaresBrowserOwnership: true as const,
  approve: async () => true,
  allowAssistantText: async () => fn(),
});

const CASES = [
  { id: 'deepseek', url: 'https://chat.deepseek.com/a/chat/s/mock', key: 'ds1',
    html: '<div data-message-id="ds1"><div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>' },
  { id: 'gemini', url: 'https://gemini.google.com/app/mock', key: 'ge1',
    html: '<model-response data-message-id="ge1"><message-content class="model-response-text"><div class="markdown">GE answer</div></message-content></model-response>' },
  { id: 'mistral', url: 'https://chat.mistral.ai/chat/mock', key: 'mi1',
    html: '<div data-message-id="mi1" data-message-author-role="assistant"><div class="markdown">MI answer</div></div>' },
] as const;

async function reservePort() {
  const s = createServer();
  await new Promise<void>((done) => s.listen(0, '127.0.0.1', done));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((done) => s.close(() => done()));
  return port;
}

test('G160 unverified Qwen DOM, wrong IDs, browser origin and missing consent refuse', async () => {
  await assert.rejects(G160OtherProviderObserver.attach('http://127.0.0.1:9222',
    'TABABCDEFG', 'qwen', consent(() => true)), /not independently verified/);
  await assert.rejects(G160OtherProviderObserver.attach('http://evil.example:9222',
    'TABABCDEFG', 'deepseek', consent(() => true)), /denied/);
  await assert.rejects(G160OtherProviderObserver.attach('http://127.0.0.1:9222',
    'invalid id!', 'gemini', consent(() => true)), /explicit tab/);
  await assert.rejects(G160OtherProviderObserver.attach('http://127.0.0.1:9222',
    'TABABCDEFG', 'mistral', { ...consent(() => true), approve: async () => false }), /permission/);
});

test('G160 real existing CDP Chromium provider-specific bodies, exact identity and revocation', {
  skip: process.platform !== 'linux' || process.env.G160_REAL_CDP !== '1',
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'g160-cdp-'));
  const port = await reservePort();
  const endpoint = `http://127.0.0.1:${port}`;
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, args: [`--remote-debugging-port=${port}`, '--no-first-run'],
      serviceWorkers: 'block', acceptDownloads: false,
    });
    const page = context.pages()[0] ?? await context.newPage();
    for (const item of CASES) {
      await page.route(new URL(item.url).origin + '/**', (route) => route.fulfill({
        status: 200, contentType: 'text/html',
        body: `<body>${item.html}<div data-message-author-role="user">PRIVATE_USER</div>` +
          '<div class="reasoning">HIDDEN_REASONING</div><input type="password" value="PRIVATE_TOKEN"/></body>',
      }));
      await page.goto(item.url, { waitUntil: 'domcontentloaded' });
      const discovery = new ExplicitCdpReadBridge(endpoint, consent(() => true));
      await discovery.open();
      const tab = (await discovery.tabs()).find((t) => t.providerID === item.id);
      assert.ok(tab, 'real Chromium page target not discovered');
      discovery.close();
      let allowed = true;
      const observer = await G160OtherProviderObserver.attach(endpoint, tab.tabID,
        item.id, consent(() => allowed));
      try {
        const answer = await observer.sample();
        const fixtureAnswer = item.id === 'deepseek' ? 'DS answer' :
          item.id.slice(0, 2).toUpperCase() + ' answer';
        assert.deepEqual(answer, { messageKey: item.key, text: fixtureAnswer });
        const parts: string[] = [];
        let updated = false;
        for await (const fragment of observer.observe('readTurn', item.key, 2)) {
          if (fragment.kind === 'text') parts.push(fragment.value);
          if (!updated) {
            updated = true;
            const selector = item.id === 'deepseek' ? '.ds-assistant-message-main-content'
              : '.markdown';
            await page.locator(selector).evaluate((el) => { el.textContent += ' more'; });
          }
        }
        assert.deepEqual(parts, [fixtureAnswer, ' more']);
        assert.doesNotMatch(parts.join(''), /PRIVATE_USER|PRIVATE_TOKEN|HIDDEN_REASONING/);
        allowed = false;
        await assert.rejects(observer.sample(), /revoked/);
        allowed = true;
        await page.reload(); // unchanged origin/URL/target ID, changed loader ID
        await assert.rejects(observer.sample(), /document replaced/);
        await page.goto('about:blank');
        await assert.rejects(observer.sample(), /replaced|changed/);
      } finally { await observer.close(); }
      await page.title(); // CDP detach must not close user browser.
    }
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
