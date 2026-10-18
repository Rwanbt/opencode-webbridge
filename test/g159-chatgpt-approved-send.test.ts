import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PROMPT_CHARS } from '../src/core/prompt-bound.js';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { g159ConsumeOnce, g159SendChatgptOnce, type G159SendConsent } from '../src/providers/g159-chatgpt-approved-send.js';

const privateDir = () => mkdtemp(join(tmpdir(), 'webbridge-g159-'));
const fakeAction = { sessionID: 'session_12345', turnID: 'turn_12345', tabID: 'target_12345',
  generation: 1, url: 'https://chatgpt.com/', providerID: 'chatgpt' as const,
  promptSHA256: 'a'.repeat(64) };
const consent = (approveSend: G159SendConsent['approveSend'] = async () => true,
  isStillApproved: G159SendConsent['isStillApproved'] = () => true): G159SendConsent => ({
  userDeclaresBrowserOwnership: true, approve: async () => true, approveSend, isStillApproved,
});
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const number = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return number;
}

test('G159 durable journal consumes EXACTLY one turn before UI effect, no reset or blind replay', async () => {
  const dir = await privateDir();
  try {
    await g159ConsumeOnce(dir, fakeAction.turnID, fakeAction);
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const marker = JSON.parse(await readFile(join(dir, files[0]), 'utf8'));
    assert.equal(marker.status, 'uncertain');
    assert.equal(marker.version, 1);
    assert.doesNotMatch(JSON.stringify(marker), /prompt|secret|token|session_12345/i);
    await assert.rejects(g159ConsumeOnce(dir, fakeAction.turnID,
      { ...fakeAction, promptSHA256: 'b'.repeat(64) }), /already consumed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('G159 rejects malformed turn, prompt, endpoint before opening any CDP connection', async () => {
  const base = { endpoint: 'http://127.0.0.1:9222', tabID: fakeAction.tabID,
    sessionID: fakeAction.sessionID, turnID: fakeAction.turnID, prompt: 'hello',
    journalDir: '/nonexistent', consent: consent() };
  await assert.rejects(g159SendChatgptOnce({ ...base, turnID: '../escape' }), /invalid/);
  await assert.rejects(g159SendChatgptOnce({ ...base, prompt: '\u0000secret' }), /invalid/);
  await assert.rejects(g159SendChatgptOnce({ ...base, prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }), /invalid/);
  await assert.rejects(g159SendChatgptOnce({ ...base, endpoint: 'http://localhost:9222' }), /loopback/);
});

test('G159 existing Linux Chrome CDP: approved one click, denied/revoked/ambiguous no-click',
  { skip: process.platform !== 'linux' || process.env.G159_REAL_CDP !== '1' }, async () => {
    const profile = await privateDir();
    const journal = await privateDir();
    const debugPort = await freePort();
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true, args: [`--remote-debugging-port=${debugPort}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = context.pages()[0] ?? await context.newPage();
      await page.route('https://chatgpt.com/**', async (route) => route.fulfill({
        status: 200, contentType: 'text/html', body: `<!doctype html><html><body>
        <div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Message"></div>
        <button data-testid="send-button" aria-label="Send message" disabled>Send</button>
        <input type="password" value="PRIVATE-DO-NOT-LEAK">
        <script>
          window.sent = [];
          const editor = document.getElementById('prompt-textarea');
          const button = document.querySelector('[data-testid="send-button"]');
          editor.addEventListener('input', () => { button.disabled = !editor.textContent.trim(); });
          button.addEventListener('click', () => {
            window.sent.push(editor.textContent); editor.textContent = ''; button.disabled = true;
          });
        </script></body></html>`,
      }));
      const url = 'https://chatgpt.com/c/g159-fixture';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const endpoint = `http://127.0.0.1:${debugPort}`;
      const discovery = new ExplicitCdpReadBridge(endpoint, consent());
      await discovery.open();
      const tabID = (await discovery.tabs()).find((t) => t.providerID === 'chatgpt')?.tabID;
      assert.ok(tabID, 'real Chromium tab ID unavailable');
      discovery.close();
      const base = { endpoint, tabID, sessionID: 'session_12345',
        prompt: 'G159 approved fixture only', journalDir: journal };
      const sent = () => page.evaluate(() => (window as unknown as { sent: string[] }).sent);
      // Approval is SEPARATE from CDP discovery; do not even fill before approval.
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_declined', consent: consent(async () => false),
      }), /declined/);
      assert.deepEqual(await sent(), []);
      assert.equal(await page.locator('#prompt-textarea').textContent(), '');
      assert.equal((await readdir(journal)).length, 0);

      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_userdraft', consent: consent(async () => {
          await page.locator('#prompt-textarea').fill('USER OWN DRAFT'); return true;
        }),
      }), /user draft changed/);
      assert.equal(await page.locator('#prompt-textarea').textContent(), 'USER OWN DRAFT');
      assert.deepEqual(await sent(), []);
      await page.locator('#prompt-textarea').fill('');

      const outcome = await g159SendChatgptOnce({
        ...base, turnID: 'turn_approved', consent: consent(async (action, displayed) => {
          assert.equal(action.tabID, tabID);
          assert.equal(action.turnID, 'turn_approved');
          assert.equal(action.sessionID, base.sessionID);
          assert.equal(action.promptSHA256.length, 64);
          assert.equal(displayed, base.prompt); return true;
        }),
      });
      assert.deepEqual(outcome, { status: 'uncertain', turnID: 'turn_approved' });
      assert.deepEqual(await sent(), ['G159 approved fixture only']);
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_approved', consent: consent(),
      }), /G159_SEND_UNCERTAIN|already consumed/);
      assert.equal((await sent()).length, 1);

      // A duplicate editable input MUST block even operator approval.
      await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
        '<div role="textbox" data-testid="composer-input" contenteditable="true"></div>'));
      let asked = 0;
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_ambiguous', consent: consent(async () => { asked++; return true; }),
      }), /ambiguous/);
      assert.equal(asked, 0);
      assert.equal((await sent()).length, 1);
      await page.locator('[data-testid="composer-input"]').evaluate((element) => element.remove());

      // Permission revocation AFTER filling (effect consumed), NEVER click/replay.
      let reads = 0;
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_revoked', consent: consent(async () => true, () => ++reads < 3),
      }), /G159_SEND_UNCERTAIN/);
      assert.equal((await sent()).length, 1);
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_revoked', consent: consent(),
      }), /already consumed|nonempty user draft/);
      // The revocation leaves a draft; never silently overwrite it.
      assert.equal(await page.locator('#prompt-textarea').textContent(), base.prompt);
      await page.locator('#prompt-textarea').fill('');

      // Reload to EXACTLY the same URL during approval: only CDP loaderId changes.
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_sameurl', consent: consent(async () => {
          await page.reload({ waitUntil: 'domcontentloaded' }); return true;
        }),
      }), /document generation|navigation/);
      assert.equal((await readdir(journal)).length, 2);
      assert.deepEqual(await sent(), []);

      // Navigate during operator approval: same tab ID is NOT enough to send.
      await assert.rejects(g159SendChatgptOnce({
        ...base, turnID: 'turn_navigate', consent: consent(async () => {
          await page.goto('about:blank'); return true;
        }),
      }), /replaced|navigation|denied/);
      assert.equal((await readdir(journal)).length, 2);
      assert.equal(page.url(), 'about:blank');
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(journal, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
