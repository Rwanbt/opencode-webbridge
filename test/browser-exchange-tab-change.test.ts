import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { streamBrowserTurn } from '../src/core/browser-exchange.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { TabClaim } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'sess-tab', providerID: 'qwen', tabID: 'tab-tab', accountRef: 'acct-tab' };

test('streamBrowserTurn fails closed when the tab binding changes mid-stream', async () => {
  let polled = 0;
  const port = new FakeBrowserPort();
  await port.claim(claim);
  // Monkey: after first poll, release and re-claim is not allowed; instead simulate
  // a stale binding by calling events with a tampered claim.
  const originalEvents = port.events.bind(port);
  port.events = async (binding, turnID, afterSeq) => {
    polled++;
    if (polled === 1) {
      // First poll returns a fragment normally.
      return [{ seq: 1, kind: 'text', turnID, value: 'before-tab-change' }];
    }
    // Subsequent poll with the original claim must now fail ownership because
    // the tab was released in between.
    await port.release(claim).catch(() => {});
    return originalEvents(binding, turnID, afterSeq);
  };
  const stream = streamBrowserTurn(port, claim, { turnID: 't-tab', prompt: 'hello' }, 4);
  const first = await stream.next();
  assert.deepEqual(first, { value: 'before-tab-change', done: false });
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /.+/);
  await port.release(claim).catch(() => {});
});
