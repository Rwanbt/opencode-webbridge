/** The CDP page driver, exercised against the REAL browser.
 *
 *  Gated by WEBBRIDGE_CDP_LIVE=1 because it needs a browser on the loopback
 *  debug endpoint. It is the point of the module: it must reach a tab that
 *  Playwright's own enumeration can miss entirely, read the same DOM the
 *  transport reads, and expose the same session methods. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CdpPage, cdpTargets, elementsExpression } from '../src/browser/cdp-page.js';

const LIVE = process.env.WEBBRIDGE_CDP_LIVE === '1';
const ENDPOINT = process.env.WEBBRIDGE_CDP_ENDPOINT ?? 'http://127.0.0.1:9222';
const ASSISTANT = '[data-content-search-unit-key$=":assistant"]';

test('the visibility pseudo-class is translated, never passed to CSS', () => {
  const plain = elementsExpression('.a');
  assert.ok(plain.includes('querySelectorAll(".a")'));
  assert.ok(!plain.includes('filter'), 'no filter when nothing asks for visibility');
  const visible = elementsExpression('button:visible');
  assert.ok(visible.includes('querySelectorAll("button")'), 'the pseudo-class is stripped');
  assert.ok(!visible.includes(':visible'), 'never handed to querySelectorAll');
  assert.ok(visible.includes('offsetWidth'), 'visibility is filtered explicitly');
  assert.throws(() => elementsExpression(':visible'), /only a visibility pseudo-class/);
  assert.throws(() => elementsExpression(''), /invalid selector/);
});

test('the driver reads a real tab that Playwright may not enumerate', {
  skip: !LIVE,
}, async () => {
  const targets = await cdpTargets(ENDPOINT);
  assert.ok(targets.length >= 1, 'the inventory must advertise at least one page');
  for (const target of targets) {
    assert.ok(target.id.length >= 4);
    assert.ok(target.wsUrl.startsWith('ws://'));
  }
  const chatgpt = targets.find((target) => target.url.startsWith('https://chatgpt.com'));
  assert.ok(chatgpt, 'the ChatGPT tab must be reachable through the inventory');

  const page = await CdpPage.open(chatgpt);
  try {
    assert.ok(page.url().startsWith('https://chatgpt.com'), 'the page reports its own URL');

    // The SAME in-page read the transport performs, through the new channel.
    const count = await page.evaluate((selector: string) =>
      document.querySelectorAll(selector).length, ASSISTANT);
    assert.ok(typeof count === 'number' && count >= 1, 'assistant turns are readable');

    const locator = page.locator(ASSISTANT);
    assert.equal(await locator.count(), count, 'the locator agrees with the raw read');
    assert.equal(await locator.isVisible(), true, 'a present element is visible');

    // A visibility-filtered locator must not blow up on a real page.
    const visibleComposer = page.locator('[contenteditable="true"]:visible, textarea:visible');
    assert.ok((await visibleComposer.count()) >= 0);

    // The session methods the transport calls must work on this channel.
    const session = await page.session();
    const tree = await session.send('Page.getFrameTree') as { frameTree?: { frame?: { url?: string } } };
    assert.ok(tree?.frameTree?.frame?.url?.startsWith('https://chatgpt.com'),
      'the frame tree is readable through the session');
    await session.detach();

    // A missing element is reported, never invented.
    assert.equal(await page.locator('#definitely-not-here').count(), 0);
    await assert.rejects(page.locator('#definitely-not-here').click(), /nothing to click/);
  } finally { await page.close(); }
});
