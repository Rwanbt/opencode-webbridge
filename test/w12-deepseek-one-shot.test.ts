import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { w12SendDeepSeekOnce, type W12Consent } from '../src/providers/w12-deepseek-one-shot.js';

const temp = () => mkdtemp(join(tmpdir(), 'w12-deepseek-'));
const consent = (approveSend: W12Consent['approveSend'] = async () => true,
  isStillApproved: W12Consent['isStillApproved'] = () => true): W12Consent => ({
  userDeclaresBrowserOwnership: true, approve: async () => true, approveSend, isStillApproved,
});
async function port(): Promise<number> {
  const net = createServer();
  await new Promise<void>((done) => net.listen(0, '127.0.0.1', done));
  const number = (net.address() as { port: number }).port;
  await new Promise<void>((done) => net.close(() => done()));
  return number;
}
const HTML = `<!DOCTYPE html><html><body>
  <textarea data-testid="deepseek-chat-input" aria-label="Message DeepSeek"></textarea>
  <button type="button" data-testid="deepseek-send-button" disabled>Send</button>
  <input type="password" value="NEVER_READ_PASSWORD">
  <section class="ds-assistant-message-main-content" data-message-id="someoldanswer">Old answer</section>
  <script>
    window.sent = [];
    const editor = document.querySelector('textarea');
    const button = document.querySelector('button');
    editor.addEventListener('input', () => { button.disabled = !editor.value.trim(); });
    button.addEventListener('click', () => {
      window.sent.push(editor.value); editor.value = ''; button.disabled = true;
    });
  </script></body></html>`;

test('W12 refuses invalid prompt/endpoint before any browser effect', async () => {
  const base = { endpoint: 'http://127.0.0.1:9222', tabID: 'target_12345',
    sessionID: 'session_12345', turnID: 'turn_12345', prompt: 'safe test',
    journalDir: 'private-journal', consent: consent() };
  await assert.rejects(w12SendDeepSeekOnce({ ...base, prompt: 'x'.repeat(4001) }), /invalid/);
  await assert.rejects(w12SendDeepSeekOnce({ ...base, prompt: 'secret\u0000' }), /invalid/);
  await assert.rejects(w12SendDeepSeekOnce({ ...base, turnID: '../injection' }), /invalid/);
  await assert.rejects(w12SendDeepSeekOnce({ ...base, endpoint: 'http://evil.test:9222' }), /loopback/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(w12SendDeepSeekOnce({ ...base, signal: controller.signal }), /cancelled/);
});

test('W12 real CDP to intercepted HTTPS: consent, single effect, revocation, epoch, replay', {
  skip: process.platform !== 'linux' || process.env.W12_REAL_CDP !== '1',
}, async () => {
  const profile = await temp(), journal = await temp(), debugPort = await port();
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      headless: true, args: [`--remote-debugging-port=${debugPort}`, '--no-first-run'],
      serviceWorkers: 'block', acceptDownloads: false,
    });
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.route('https://chat.deepseek.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: HTML }));
    const url = 'https://chat.deepseek.com/a/chat/s/w12-fixture';
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const endpoint = `http://127.0.0.1:${debugPort}`;
    const discovery = new ExplicitCdpReadBridge(endpoint, consent());
    await discovery.open();
    const tabID = (await discovery.tabs()).find((t) => t.providerID === 'deepseek')?.tabID;
    assert.ok(tabID);
    discovery.close();
    const base = { endpoint, tabID, sessionID: 'session_12345', journalDir: journal,
      prompt: 'W12 explicit operator test', consent: consent() };
    const sent = () => page.evaluate(() => (window as unknown as { sent: string[] }).sent);
    const editor = page.locator('textarea[data-testid="deepseek-chat-input"]');
    const files = () => readdir(journal);
    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_declined', consent: consent(async () => false),
    }), /declined/);
    assert.deepEqual(await sent(), []);
    assert.equal(await editor.inputValue(), '');
    assert.deepEqual(await files(), []);

    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_humandraft', consent: consent(async () => {
        await editor.fill('HUMAN DRAFT'); return true;
      }),
    }), /draft changed/);
    assert.equal(await editor.inputValue(), 'HUMAN DRAFT');
    assert.deepEqual(await files(), []);
    await editor.fill('');

    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
      '<button data-testid="deepseek-send-button">Untrusted duplicate</button>'));
    let approvals = 0;
    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_duplicate', consent: consent(async () => { approvals++; return true; }),
    }), /ambiguous/);
    assert.equal(approvals, 0);
    assert.deepEqual(await files(), []);
    await page.locator('button[data-testid="deepseek-send-button"]').last().evaluate((el) => el.remove());

    const outcome = await w12SendDeepSeekOnce({
      ...base, turnID: 'turn_approved', consent: consent(async (action, display) => {
        assert.equal(action.providerID, 'deepseek');
        assert.equal(action.tabID, tabID);
        assert.equal(action.sessionID, base.sessionID);
        assert.equal(action.url, url);
        assert.equal(action.promptSHA256.length, 64);
        assert.equal(display, base.prompt);
        return true;
      }),
    });
    assert.deepEqual(outcome, { status: 'uncertain', turnID: 'turn_approved' });
    assert.deepEqual(await sent(), [base.prompt]);
    const marker = JSON.parse(await readFile(join(journal, (await files())[0]), 'utf8'));
    assert.equal(marker.status, 'uncertain');
    assert.doesNotMatch(JSON.stringify(marker), /W12 explicit|NEVER_READ_PASSWORD|session_12345/);
    await assert.rejects(w12SendDeepSeekOnce({ ...base, turnID: 'turn_approved' }),
      /W12_SEND_UNCERTAIN|already consumed/);
    assert.deepEqual(await sent(), [base.prompt]);

    let approvalsChecked = 0;
    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_revoked',
      consent: consent(async () => true, () => ++approvalsChecked < 4),
    }), /W12_SEND_UNCERTAIN/);
    assert.deepEqual(await sent(), [base.prompt]);
    assert.equal(await editor.inputValue(), base.prompt);
    await editor.fill('');
    assert.equal((await files()).length, 2);
    await assert.rejects(w12SendDeepSeekOnce({ ...base, turnID: 'turn_revoked' }),
      /already consumed/);

    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_reload', consent: consent(async () => {
        await page.reload({ waitUntil: 'domcontentloaded' }); return true;
      }),
    }), /document replaced/);
    assert.equal((await files()).length, 2);
    assert.deepEqual(await sent(), []);

    await assert.rejects(w12SendDeepSeekOnce({
      ...base, turnID: 'turn_navigate', consent: consent(async () => {
        await page.goto('about:blank'); return true;
      }),
    }), /replaced|changed|denied/);
    assert.equal((await files()).length, 2);
    await page.title(); // Adapter detached; browser remains alive.
  } finally {
    await browser?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await rm(journal, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
