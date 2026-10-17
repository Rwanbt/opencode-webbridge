/** One real Chromium instance against the explicit loopback-only fake chat UI. */
import { strict as assert } from 'node:assert';
import { openLocalChatPage } from '../dist/src/testing/local-chat-page.js';
import { openLocalBrowserCompanion, submitLocalPageTurn } from '../dist/src/testing/local-browser-companion.js';

const site = await openLocalChatPage();
let browser;
try {
  browser = await openLocalBrowserCompanion();
  await assert.rejects(submitLocalPageTurn(browser.page, 'https://example.com/', 'forbidden'),
    /only explicit local test page URLs/);
  await assert.rejects(submitLocalPageTurn(browser.page, new URL('/other', site.url).href, 'forbidden'),
    /only explicit local test page URLs/);
  const prompt = 'WEBBRIDGE_LOCAL_READ_COMMIT_TEST';
  const fragments = [];
  const response = await submitLocalPageTurn(browser.page, site.url, prompt, async (chunk, seq) => {
    assert.equal(seq, fragments.length + 1);
    fragments.push(chunk);
  });
  assert.equal(response, `WEBBRIDGE_LOCAL_PAGE_OK:${prompt}`);
  assert.equal(fragments.length, 3);
  assert.equal(fragments.join(''), response);
  assert.equal(await browser.page.title(), 'WebBridge Local Fixture');
  assert.equal(await browser.page.locator('[role="status"]').getAttribute('data-state'), 'finished');
  let stopped = false;
  await assert.rejects(submitLocalPageTurn(browser.page, site.url, 'INTERRUPT_ME', async (_chunk, seq) => {
    if (seq === 1) { stopped = true; await browser.page.getByRole('button', { name: 'Stop' }).click(); }
  }), /uncertain: stopped after submit/);
  assert.equal(stopped, true);
  assert.equal(await browser.page.locator('[role="status"]').getAttribute('data-state'), 'stopped');
  let navigated = false;
  await assert.rejects(submitLocalPageTurn(browser.page, site.url, 'RELOAD_DURING_STREAM', async (_chunk, seq) => {
    if (seq === 1) { navigated = true; await browser.page.reload({ waitUntil: 'domcontentloaded' }); }
  }), /uncertain: tab or document changed/);
  assert.equal(navigated, true);
  console.log('Local fake-chat Chromium E2E PASS: loopback-only, one page, no commercial accounts');
} finally {
  await browser?.close();
  await site.close();
}
