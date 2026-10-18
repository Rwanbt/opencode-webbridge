import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';
import { g166ChatgptManualTurn, type G166ManualTurn, type G166TurnEvent } from '../src/runtime/g166-chatgpt-manual-turn.js';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
const collect = async (request: G166ManualTurn): Promise<G166TurnEvent[]> => {
  const result: G166TurnEvent[] = [];
  for await (const event of g166ChatgptManualTurn(request)) result.push(event);
  return result;
};
const consent = () => ({
  userDeclaresBrowserOwnership: true as const, approve: async () => true,
  allowAssistantText: async () => true, approveSend: async () => true,
  isStillApproved: () => true,
});

test('G166 requires bounded manual polling before connecting', async () => {
  const request = { endpoint: 'http://127.0.0.1:9222', tabID: 'ABCDEFGH',
    sessionID: 'session_12345', turnID: 'turn_12345', prompt: 'hi',
    journalDir: '/none', consent: consent(), polls: 33 };
  await assert.rejects(collect(request), /polling budget/);
  await assert.rejects(collect({ ...request, polls: 1, intervalMs: -1 }), /polling budget/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(collect({ ...request, polls: 1, signal: abort.signal }), /cancelled/);
});

test('G166 intercepted HTTPS Chromium: one approved click, progressive candidate, uncertain finality and security gates',
  { skip: process.platform !== 'linux' || process.env.G166_REAL_CDP !== '1' }, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'g166-chrome-'));
    const journal = await mkdtemp(join(tmpdir(), 'g166-journal-'));
    const endpoint = `http://127.0.0.1:${await freePort()}`;
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true, args: [`--remote-debugging-port=${new URL(endpoint).port}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = context.pages()[0] ?? await context.newPage();
      await page.route('https://chatgpt.com/**', (route) => route.fulfill({
        status: 200, contentType: 'text/html', body: `<!doctype html><html><body>
        <article data-turn="assistant" data-turn-id="old_answer"><div class="markdown">Older private answer</div></article>
        <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
        <button data-testid="send-button" disabled>Send</button>
        <input type="password" value="DO-NOT-EXPOSE-SECRET">
        <script>
        window.sent = []; window.mode = 'normal';
        const editor = document.getElementById('prompt-textarea');
        const send = document.querySelector('button');
        editor.addEventListener('input', () => send.disabled = !editor.textContent.trim());
        send.addEventListener('click', () => {
          window.sent.push(editor.textContent); editor.textContent = ''; send.disabled = true;
          const mode = window.mode;
          setTimeout(() => {
            if (mode === 'ambiguous') {
              document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant" data-turn-id="ambiguous"><div class="markdown">A</div><div class="markdown">B</div></article>');
            } else if (mode !== 'late') {
              document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant" data-turn-id="new_answer"><div class="markdown">Candidate</div></article>');
            }
          }, 20);
          setTimeout(() => {
            const text = document.querySelector('[data-turn-id="new_answer"] .markdown');
            if (text) text.textContent = 'Candidate response complete';
            if (mode === 'late') document.body.insertAdjacentHTML('beforeend', '<article data-turn="assistant" data-turn-id="late_answer"><div class="markdown">Late response</div></article>');
          }, 280);
        });
        </script></body></html>`,
      }));
      const url = 'https://chatgpt.com/c/g166-fixture';
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const bridge = new ExplicitCdpReadBridge(endpoint, consent());
      await bridge.open();
      const tabID = (await bridge.tabs()).find((t) => t.providerID === 'chatgpt')?.tabID;
      assert.ok(tabID);
      bridge.close();
      const base = { endpoint, tabID, sessionID: 'session_12345',
        prompt: 'G166 fixture explicitly approved', journalDir: journal, consent: consent() };
      const sent = () => page.evaluate(() => (window as unknown as { sent: string[] }).sent);
      const run = (turnID: string, extras: Partial<G166ManualTurn> = {}) =>
        collect({ ...base, turnID, polls: 16, intervalMs: 20, ...extras });

      await assert.rejects(run('turn_wrongtab', { tabID: 'wrongTab_12345' }), /selected|target/);
      assert.deepEqual(await sent(), []);
      await assert.rejects(run('turn_declined', { consent: {
        ...consent(), approveSend: async () => false,
      } }), /declined/);
      assert.deepEqual(await sent(), []);

      const events = await run('turn_approved');
      assert.deepEqual(await sent(), [base.prompt]);
      assert.equal(events.at(-1)?.kind, 'terminal');
      assert.deepEqual(events.at(-1), { kind: 'terminal', turnID: 'turn_approved',
        status: 'uncertain', reason: 'provider-finality-unverified', messageKey: 'new_answer' });
      const fragments = events.filter((e) => e.kind === 'candidate');
      assert.ok(fragments.length >= 1);
      assert.equal(fragments.map((e) => e.text).join(''), 'Candidate response complete');
      assert.ok(fragments.every((e) => e.attribution === 'unverified' && e.turnID === 'turn_approved'));
      assert.doesNotMatch(JSON.stringify(events), /Older private answer|DO-NOT-EXPOSE-SECRET/);
      await assert.rejects(run('turn_approved'), /already consumed/);
      assert.equal((await sent()).length, 1);

      await page.reload();
      await page.evaluate(() => (window as unknown as { mode: string }).mode = 'ambiguous');
      const ambiguous = await run('turn_ambiguous', { polls: 3 });
      assert.equal(ambiguous.filter((e) => e.kind === 'candidate').length, 0);
      assert.equal(ambiguous.at(-1)?.kind, 'terminal');
      assert.equal((ambiguous.at(-1) as Extract<G166TurnEvent, { kind: 'terminal' }>).reason, 'no-new-candidate');

      await page.reload();
      await page.evaluate(() => (window as unknown as { mode: string }).mode = 'late');
      const late = await run('turn_late', { polls: 3 });
      assert.equal(late.filter((e) => e.kind === 'candidate').length, 0);
      assert.equal((late.at(-1) as Extract<G166TurnEvent, { kind: 'terminal' }>).reason, 'no-new-candidate');
      await page.waitForTimeout(350);
      assert.equal((await sent()).length, 1); // Late DOM never triggers resending.

      await page.reload();
      let readAllowed = true;
      const revoked = await run('turn_revoked', { consent: {
        ...consent(), allowAssistantText: async () => readAllowed,
        approveSend: async () => { readAllowed = false; return true; },
      } });
      assert.equal(revoked.filter((e) => e.kind === 'candidate').length, 0);
      assert.equal((revoked.at(-1) as Extract<G166TurnEvent, { kind: 'terminal' }>).reason,
        'read-revoked-or-document-changed');

      await page.reload();
      await assert.rejects(run('turn_reloaded', { consent: {
        ...consent(), approveSend: async () => { await page.reload(); return true; },
      } }), /navigation|document generation/);
      assert.deepEqual(await sent(), []);

      await page.reload();
      const abort = new AbortController();
      const cancelled: G166TurnEvent[] = [];
      for await (const e of g166ChatgptManualTurn({ ...base, turnID: 'turn_cancel',
        polls: 16, intervalMs: 20, signal: abort.signal })) {
        cancelled.push(e);
        if (e.kind === 'candidate') abort.abort();
      }
      assert.equal((cancelled.at(-1) as Extract<G166TurnEvent, { kind: 'terminal' }>).reason, 'cancelled');
      assert.equal((await sent()).length, 1);
      assert.equal((await readdir(journal)).length, 5);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(journal, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
