/** The CDP page driver, exercised against the REAL browser.
 *
 *  Gated by WEBBRIDGE_CDP_LIVE=1 because it needs a browser on the loopback
 *  debug endpoint. It is the point of the module: it must reach a tab that
 *  Playwright's own enumeration can miss entirely, read the same DOM the
 *  transport reads, and expose the same session methods. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
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

test('a tab that never answers is reloaded once, then refused with the cause', async () => {
  // A WebSocket server that completes the handshake and then NEVER replies: the
  // faithful shape of a discarded or frozen tab, which Chrome keeps listed in the
  // inventory while its renderer no longer answers. This is the case the revive
  // path exists for, so it is tested rather than asserted.
  const sockets = new Set<Duplex>();
  const server = createServer();
  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const key = String(request.headers['sec-websocket-key'] ?? '');
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  try {
    const target = {
      id: 'silent', url: 'https://example.test/',
      wsUrl: `ws://127.0.0.1:${port}/devtools/page/silent`,
    };
    const started = Date.now();
    await assert.rejects(
      CdpPage.open(target, { revive: true, handshakeTimeoutMs: 150 }),
      /after a reload/,
      'the refusal must say a reload was already attempted',
    );
    // First handshake, then the reload, then the retry: the revive really did
    // retry instead of failing at the first timeout.
    assert.ok(Date.now() - started >= 250, 'the revive retried before giving up');
  } finally {
    // Destroy the server side and NEVER await the close callback. Awaiting it is
    // what hung this test -- and, with no runner timeout in CI, hung the whole
    // suite for half an hour instead of failing. A test must fail, not stall.
    for (const socket of sockets) socket.destroy();
    server.close();
  }
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
