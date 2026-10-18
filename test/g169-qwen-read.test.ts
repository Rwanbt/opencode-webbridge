import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { G169QwenRead, type G169Consent } from '../src/providers/g169-qwen-read.js';

const grant = (controller = new AbortController(), allow = async () => true,
  still = () => true): G169Consent => ({
  userDeclaresBrowserOwnership: true, approve: async () => true,
  allowAssistantText: allow, isStillApproved: still, signal: controller.signal,
});
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}
const html = `<!doctype html><html><body>
  <main data-webbridge-g169-fixture="intercepted-qwen-v1">
    <article data-webbridge-g169-speaker="user"><p>PRIVATE USER PROMPT</p></article>
    <article data-webbridge-g169-speaker="assistant" data-message-id="qwen-answer-1">
      <div data-webbridge-g169-body>SAFE FIXTURE ANSWER</div>
      <div data-webbridge-g169-reasoning>PRIVATE REASONING</div>
    </article>
  </main><input type="password" value="PRIVATE TOKEN"></body></html>`;

test('G169 rejects implicit/invalid target and unowned debug port before browser access', async () => {
  await assert.rejects(G169QwenRead.attach('http://127.0.0.1:9222',
    '', grant()), /explicit tab/);
  await assert.rejects(G169QwenRead.attach('http://evil.example:9222',
    'A12345678', grant()), /loopback/);
  await assert.rejects(G169QwenRead.attach('http://127.0.0.1:9222',
    'A12345678', { ...grant(), approve: async () => false }), /permission/);
  await assert.rejects(G169QwenRead.attach('http://127.0.0.1:9222',
    'A12345678', { ...grant(), signal: undefined as never }), /explicit tab/);
});

test('G169 real isolated Chromium: origin/target/loader epoch, body fixture only, revocation and abort',
  { skip: process.platform !== 'linux' || process.env.G169_REAL_CDP !== '1' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'g169-qwen-'));
    const port = await freePort();
    const endpoint = `http://127.0.0.1:${port}`;
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      context = await chromium.launchPersistentContext(dir, {
        headless: true, args: [`--remote-debugging-port=${port}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = context.pages()[0] ?? await context.newPage();
      await page.route('https://chat.qwen.ai/**', (route) => route.fulfill({
        contentType: 'text/html', status: 200, body: html,
      }));
      const url = 'https://chat.qwen.ai/c/local-fixture';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const listing = new ExplicitCdpReadBridge(endpoint, grant());
      await listing.open();
      const tab = (await listing.tabs()).find((item) => item.providerID === 'qwen');
      assert.ok(tab, 'missing real Qwen-origin Chromium target');
      listing.close();
      await assert.rejects(G169QwenRead.attach(endpoint, tab.tabID + 'X', grant()),
        /exact Qwen target/);
      let allowed = true;
      const observer = await G169QwenRead.attach(endpoint, tab.tabID, grant(
        new AbortController(), async () => allowed, () => allowed));
      try {
        assert.deepEqual(await observer.probe(), {
          providerID: 'qwen', tabID: tab.tabID, generation: tab.generation,
          documentBound: true, liveSiteSelectorsVerified: false,
          readStatus: 'NO_GO_UNVERIFIED_LIVE_QWEN_DOM',
        });
        const previousFlag = process.env.G169_INTERCEPTED_FIXTURE;
        delete process.env.G169_INTERCEPTED_FIXTURE;
        await assert.rejects(observer.sample('qwen-answer-1'), /real Qwen DOM layout unverified/);
        if (previousFlag === undefined) delete process.env.G169_INTERCEPTED_FIXTURE;
        else process.env.G169_INTERCEPTED_FIXTURE = previousFlag;
        assert.deepEqual(await observer.sample('qwen-answer-1'), {
          messageKey: 'qwen-answer-1', text: 'SAFE FIXTURE ANSWER',
        });
        assert.doesNotMatch(JSON.stringify(await observer.sample('qwen-answer-1')),
          /PRIVATE USER|PRIVATE TOKEN|PRIVATE REASONING/);
        assert.equal(await observer.sample('nonexistent'), null);
        await page.evaluate(() => {
          const first = document.querySelector('[data-message-id="qwen-answer-1"]')!;
          first.after(first.cloneNode(true));
        });
        assert.equal(await observer.sample('qwen-answer-1'), null, 'ambiguous IDs must not leak');
        await page.evaluate(() => {
          document.querySelectorAll('[data-message-id="qwen-answer-1"]')[1].remove();
        });
        allowed = false;
        await assert.rejects(observer.sample('qwen-answer-1'), /revoked/);
        allowed = true;
        const duringRead = await G169QwenRead.attach(endpoint, tab.tabID,
          grant(new AbortController(), async () => { allowed = false; return true; },
            () => allowed));
        try { await assert.rejects(duringRead.sample('qwen-answer-1'), /revoked/); }
        finally { await duringRead.close(); allowed = true; }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await assert.rejects(observer.sample('qwen-answer-1'), /document replaced/);
      } finally { await observer.close(); }
      await page.title(); // Detached CDP reader must not close the existing browser.
      const abort = new AbortController();
      const aborted = await G169QwenRead.attach(endpoint, tab.tabID, grant(abort, async () => {
        abort.abort(); return true;
      }));
      try { await assert.rejects(aborted.sample('qwen-answer-1'), /cancelled/); }
      finally { await aborted.close(); }
      await page.goto('about:blank');
      await assert.rejects(G169QwenRead.attach(endpoint, tab.tabID, grant()),
        /exact Qwen target/);
    } finally {
      await context?.close();
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
