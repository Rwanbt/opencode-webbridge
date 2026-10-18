import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { g175BrowserProgress, type G175Request, type G175Event } from '../src/runtime/g175-browser-progress.js';

const cases = [
  { provider: 'chatgpt', url: 'https://chatgpt.com/c/g175', selector: '.markdown',
    key: 'cg_answer', markup: '<article data-turn="assistant" data-turn-id="cg_answer"><div class="markdown">First</div></article>' },
  { provider: 'deepseek', url: 'https://chat.deepseek.com/a/chat/g175', selector: '.ds-assistant-message-main-content',
    key: 'ds_answer', markup: '<div data-message-id="ds_answer"><div class="ds-assistant-message-main-content">First</div></div>' },
  { provider: 'gemini', url: 'https://gemini.google.com/app/g175', selector: '.markdown',
    key: 'ge_answer', markup: '<model-response data-message-id="ge_answer"><message-content class="model-response-text"><div class="markdown">First</div></message-content></model-response>' },
  { provider: 'mistral', url: 'https://chat.mistral.ai/chat/g175', selector: '.markdown',
    key: 'mi_answer', markup: '<div data-message-id="mi_answer" data-message-author-role="assistant"><div class="markdown">First</div></div>' },
  { provider: 'qwen', url: 'https://chat.qwen.ai/c/g175', selector: 'main',
    key: 'qw_answer', markup: '<main data-webbridge-g169-fixture="intercepted-qwen-v1"><article data-webbridge-g169-speaker="assistant" data-message-id="qw_answer"><div data-webbridge-g169-body>Fixture response</div></article></main>' },
] as const;
const collect = async (input: G175Request) => {
  const events: G175Event[] = [];
  for await (const value of g175BrowserProgress(input)) events.push(value);
  return events;
};
const consent = () => ({ userDeclaresBrowserOwnership: true as const,
  approve: async () => true, allowAssistantText: async () => true,
  isStillApproved: () => true });
async function port() {
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, '127.0.0.1', done));
  const number = (socket.address() as { port: number }).port;
  await new Promise<void>((done) => socket.close(() => done()));
  return number;
}

test('G175 rejects absent authority, corrupt selected key, polling abuse and cancelled pre-attach', async () => {
  const ctrl = new AbortController();
  const base: G175Request = { provider: 'chatgpt', endpoint: 'http://127.0.0.1:9222',
    tabID: 'correct-tab-id', messageKey: 'answer1', turnID: 'turn_12345',
    signal: ctrl.signal, consent: consent() };
  await assert.rejects(collect({ ...base, messageKey: '../unsafe!' }), /explicit/);
  await assert.rejects(collect({ ...base, polls: 33 }), /polling budget/);
  await assert.rejects(collect({ ...base, intervalMs: 1 }), /polling budget/);
  await assert.rejects(collect({ ...base, consent: { ...consent(), isStillApproved: () => false } }), /revoked/);
  ctrl.abort();
  await assert.rejects(collect(base), /cancelled/);
});

test('G175 real Chromium intercepted HTTPS: common four-provider progressive correlation, Qwen NO-GO, adversarial epochs and revocation',
  { skip: process.platform !== 'linux' || process.env.G175_REAL_CDP !== '1' }, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'g175-browser-'));
    const number = await port();
    const endpoint = `http://127.0.0.1:${number}`;
    let chromiumContext: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      chromiumContext = await chromium.launchPersistentContext(profile, {
        headless: true, args: [`--remote-debugging-port=${number}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = chromiumContext.pages()[0] ?? await chromiumContext.newPage();
      for (const site of cases) {
        await page.route(new URL(site.url).origin + '/**', (route) => route.fulfill({
          status: 200, contentType: 'text/html', body: `<!doctype html><body>${site.markup}
          <div data-message-author-role="user">PRIVATE_USER_PROMPT</div>
          <div class="reasoning">PRIVATE_REASONING</div>
          <input type="password" value="PRIVATE_PASSWORD"></body>`,
        }));
        await page.goto(site.url, { waitUntil: 'domcontentloaded' });
        const browser = new ExplicitCdpReadBridge(endpoint, consent());
        await browser.open();
        const tab = (await browser.tabs()).find((item) => item.providerID === site.provider);
        assert.ok(tab, `real Chromium CDP tab for ${site.provider} missing`);
        browser.close();
        const controller = new AbortController();
        const base: G175Request = { provider: site.provider, endpoint, tabID: tab.tabID,
          turnID: 'turn_12345', messageKey: site.key, signal: controller.signal,
          consent: consent(), polls: 3, intervalMs: 30 };
        await assert.rejects(collect({ ...base, tabID: tab.tabID + 'X' }),
          /target|selected|exact|mismatch/);
        if (site.provider === 'qwen') {
          const result = await collect(base);
          assert.deepEqual(result, [{ kind: 'terminal', turnID: base.turnID,
            provider: 'qwen', status: 'no-go', reason: 'qwen-unverified-live-dom' }]);
          // An intercepted Qwen fixture is not validation of its real commercial selectors.
          continue;
        }
        const events: G175Event[] = [];
        for await (const event of g175BrowserProgress(base)) {
          events.push(event);
          if (event.kind === 'candidate' && event.seq === 1)
            await page.locator(site.selector).evaluate((el) => { el.textContent = 'First next'; });
        }
        assert.deepEqual(events.filter((e) => e.kind === 'candidate').map((e) => e.text),
          ['First', ' next']);
        assert.ok(events.filter((e) => e.kind === 'candidate').every((e) =>
          e.correlation === 'unverified-dom' && e.provider === site.provider &&
          e.tabID === tab.tabID && e.messageKey === site.key));
        assert.deepEqual(events.at(-1), { kind: 'terminal', turnID: base.turnID,
          provider: site.provider, status: 'uncertain', reason: 'provider-finality-unverified' });
        assert.doesNotMatch(JSON.stringify(events), /PRIVATE_USER_PROMPT|PRIVATE_PASSWORD|PRIVATE_REASONING/);

        // A reworded answer must terminate uncertain, never silently replace deltas.
        const revised = g175BrowserProgress({ ...base, polls: 2, intervalMs: 20 });
        assert.equal((await revised.next()).value?.kind, 'candidate');
        await page.locator(site.selector).evaluate((el) => { el.textContent = 'Rewritten'; });
        assert.equal((await revised.next()).value?.kind, 'terminal');
        await revised.return(undefined);
        await page.reload({ waitUntil: 'domcontentloaded' });

        // Missing a selected answer cannot be upgraded to an accepted or finished turn.
        const selected = site.provider === 'chatgpt' ? 'article[data-turn="assistant"]'
          : site.provider === 'deepseek' ? '.ds-assistant-message-main-content'
          : site.provider === 'gemini' ? 'model-response'
          : '[data-message-author-role="assistant"]';
        await page.locator(selected).evaluate((el) => el.remove());
        const missing = await collect({ ...base, polls: 1 });
        assert.equal((missing.at(-1) as any).reason, 'no-message');
        assert.equal(missing.filter((e) => e.kind === 'candidate').length, 0);
        await page.reload({ waitUntil: 'domcontentloaded' });

        // Host permission is checked during every await and after each sample.
        let approved = true, reads = 0;
        const revoked = await collect({ ...base, consent: {
          ...consent(), allowAssistantText: async () => { reads++; if (reads > 2) approved = false; return true; },
          isStillApproved: () => approved,
        } });
        assert.equal((revoked.at(-1) as any).reason, 'permission-or-document-changed');

        const aborted = new AbortController();
        const cancelled: G175Event[] = [];
        for await (const value of g175BrowserProgress({ ...base, signal: aborted.signal })) {
          cancelled.push(value);
          if (value.kind === 'candidate') aborted.abort();
        }
        assert.equal((cancelled.at(-1) as any).reason, 'cancelled');

        const replacement = await collect({ ...base, messageKey: 'different_answer', polls: 1 });
        assert.equal((replacement.at(-1) as any).reason, 'message-replaced');
        await page.reload({ waitUntil: 'domcontentloaded' });
        const generator = g175BrowserProgress({ ...base, polls: 2, intervalMs: 20 });
        const first = await generator.next();
        assert.equal(first.value?.kind, 'candidate');
        await page.reload({ waitUntil: 'domcontentloaded' }); // same URL, different loaderId
        const next = await generator.next();
        assert.deepEqual(next.value, { kind: 'terminal', turnID: base.turnID,
          provider: site.provider, status: 'uncertain', reason: 'permission-or-document-changed' });
        await generator.return(undefined);
        await page.title(); // CDP clients never terminate the original browser.
      }
    } finally {
      await chromiumContext?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
