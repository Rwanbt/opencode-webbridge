import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { G157ChatgptCdpObserver } from '../src/browser/g157-chatgpt-cdp-observer.js';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';

const consent = (allowAssistantText: () => boolean) => ({
  userDeclaresBrowserOwnership: true as const,
  approve: async () => true,
  allowAssistantText: async () => allowAssistantText(),
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const number = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return number;
}

test('G157 refuses absent content consent, hostile endpoints and invalid target before CDP', async () => {
  await assert.rejects(G157ChatgptCdpObserver.attach(
    'http://127.0.0.1:9222', 'bad', consent(() => true)), /explicit tab/);
  await assert.rejects(G157ChatgptCdpObserver.attach(
    'http://evil.example:9222', 'ABCDEFGH', consent(() => true)), /denied/);
  await assert.rejects(G157ChatgptCdpObserver.attach(
    'http://127.0.0.1:9222', 'ABCDEFGH', {
      ...consent(() => true), approve: async () => false,
    }), /permission/);
});

test('G157 real CDP existing Chromium ChatGPT DOM read, progressive delta and revocation', {
  skip: process.platform !== 'linux' || process.env.G157_REAL_CDP !== '1',
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'g157-cdp-'));
  const port = await reservePort();
  const endpoint = `http://127.0.0.1:${port}`;
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let attached: G157ChatgptCdpObserver | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, args: [`--remote-debugging-port=${port}`, '--no-first-run'],
      serviceWorkers: 'block', acceptDownloads: false,
    });
    const page = context.pages()[0] ?? await context.newPage();
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<article data-turn="assistant" data-turn-id="response1"><div class="markdown">Alpha</div></article>' +
        '<input type="password" value="PRIVATE_DO_NOT_SEND"/>',
    }));
    await page.goto('https://chatgpt.com/c/fixture', { waitUntil: 'domcontentloaded' });
    const discovery = new ExplicitCdpReadBridge(endpoint, consent(() => true));
    await discovery.open();
    const selected = (await discovery.tabs()).find((t) => t.providerID === 'chatgpt');
    assert.ok(selected);
    discovery.close();
    let readAllowed = true;
    attached = await G157ChatgptCdpObserver.attach(endpoint, selected.tabID,
      consent(() => readAllowed));
    assert.deepEqual(await attached.sample(), {
      messageKey: 'response1', text: 'Alpha', layout: 'legacy', finalized: false,
    });
    const fragments: string[] = [];
    let updated = false;
    for await (const event of attached.observe('readTurn', 'response1', 3)) {
      if (event.kind === 'text') fragments.push(event.value);
      if (!updated) {
        updated = true;
        await page.locator('.markdown').evaluate((el) => { el.textContent = 'Alpha beta'; });
      }
    }
    assert.deepEqual(fragments, ['Alpha', ' beta']);
    assert.doesNotMatch(fragments.join(''), /PRIVATE_DO_NOT_SEND/);
    readAllowed = false;
    await assert.rejects(attached.sample(), /revoked/);
    readAllowed = true;
    // Same URL + same CDP tab ID but a DIFFERENT full document is not authority.
    await page.reload();
    await assert.rejects(attached.sample(), /document replaced/);
    await page.goto('about:blank');
    await assert.rejects(attached.sample(), /replaced|changed|revoked/);
    await attached.close();
    await page.title(); // CDP disconnect must NOT close the user's Chromium browser.
  } finally {
    await attached?.close();
    await context?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
