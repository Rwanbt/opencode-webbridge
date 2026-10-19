/** The CDP page driver, exercised against the REAL browser.
 *
 *  Gated by WEBBRIDGE_CDP_LIVE=1 because it needs a browser on the loopback
 *  debug endpoint. It is the point of the module: it must reach a tab that
 *  Playwright's own enumeration can miss entirely, read the same DOM the
 *  transport reads, and expose the same session methods. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CdpLocator, CdpPage, cdpTargets, elementsExpression } from '../src/browser/cdp-page.js';

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

test('attribute names and event types are validated, never passed through', async () => {
  const page = Object.create(CdpLocator.prototype) as CdpLocator;
  await assert.rejects(page.getAttribute(''), /invalid attribute name/);
  await assert.rejects(page.getAttribute('x'.repeat(129)), /invalid attribute name/);
  await assert.rejects(page.dispatchEvent(''), /invalid event type/);
  await assert.rejects(page.dispatchEvent('x'.repeat(65)), /invalid event type/);
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

    // The locator's element-first evaluate must match Playwright's shape: this is
    // what the transport uses to read a composer's value or a node's attribute.
    const composerValue = await page.locator('textarea, [contenteditable="true"]')
      .evaluate((el) => ((el as HTMLTextAreaElement).value ?? el.textContent) ?? '');
    assert.equal(typeof composerValue, 'string', 'locator.evaluate receives the ELEMENT first');

    // The rest of the surface the send path relies on, exercised with NO side
    // effect: reads, the enabled check, and the actionability gate itself.
    assert.equal(await page.locator('html').getAttribute('data-webbridge-absent'), null,
      'an absent attribute is null, never an empty string');
    const html = await page.locator('html').textContent();
    assert.ok(typeof html === 'string' && html.length > 0, 'textContent reads a real page');
    assert.equal(await page.locator('html').isEnabled(), true, 'an enabled element reports so');

    // `html` is always present, always the receiver of its own centre point, and
    // carries no handler: clicking it proves the actionability gate end to end
    // without ever touching a send control.
    await page.locator('html').click({ timeout: 2000 });

    // A missing element is reported, never invented -- and the click honours its
    // deadline before refusing, rather than firing blind.
    assert.equal(await page.locator('#definitely-not-here').count(), 0);
    assert.equal(await page.locator('#definitely-not-here').evaluate(() => 'never'), undefined);
    const started = Date.now();
    await assert.rejects(page.locator('#definitely-not-here').click({ timeout: 300 }), /nothing to click/);
    assert.ok(Date.now() - started >= 250, 'the click honoured its timeout before refusing');
    await assert.rejects(page.locator('#definitely-not-here').fill('x', { timeout: 300 }), /nothing to fill/);
  } finally { await page.close(); }
});
