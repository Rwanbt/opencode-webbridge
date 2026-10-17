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
  const response = await submitLocalPageTurn(browser.page, site.url, prompt);
  assert.equal(response, `WEBBRIDGE_LOCAL_PAGE_OK:${prompt}`);
  assert.equal(await browser.page.title(), 'WebBridge Local Fixture');
  assert.equal(await browser.page.locator('[role="status"]').getAttribute('data-state'), 'finished');
  console.log('Local fake-chat Chromium E2E PASS: loopback-only, one page, no commercial accounts');
} finally {
  await browser?.close();
  await site.close();
}
