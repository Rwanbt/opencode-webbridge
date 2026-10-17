import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { streamBrowserTurn } from '../src/core/browser-exchange.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { BrowserPort, TabClaim } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'sess-abort', providerID: 'qwen', tabID: 'tab-abort', accountRef: 'acct-abort' };

test('streamBrowserTurn does not submit when already aborted', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claim);
  const ac = new AbortController();
  ac.abort();
  const stream = streamBrowserTurn(port, claim, { turnID: 't-abort-1', prompt: 'hello' }, 4, ac.signal);
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /aborted before submit/);
  // No turn should have been recorded.
  await assert.rejects(port.events(claim, 't-abort-1', 0), /unknown turn/);
  await port.release(claim);
});

test('streamBrowserTurn stops yielding and throws when aborted mid-stream', async () => {
  const ac = new AbortController();
  let sends = 0;
  const port = {
    submit: async () => { sends++; },
    events: async (_binding: TabClaim, _id: string, after: number) => {
      if (after === 0) return [{ seq: 1, kind: 'text', turnID: 't-mid', value: 'partial' }];
      return [];
    },
  } as unknown as BrowserPort;
  const stream = streamBrowserTurn(port, claim, { turnID: 't-mid', prompt: 'hello' }, 4, ac.signal);
  const first = stream.next();
  // abort before consuming the first fragment
  ac.abort();
  await assert.rejects(first, /aborted/);
  assert.equal(sends, 1);
});

test('streamBrowserTurn rejects a late fragment arriving after abandonment', async () => {
  const ac = new AbortController();
  let polled = 0;
  const port = {
    submit: async () => {},
    events: async (_binding: TabClaim, _id: string, after: number) => {
      polled++;
      if (polled === 1) {
        ac.abort();
        return [{ seq: 1, kind: 'text', turnID: 't-late', value: 'late-fragment' }];
      }
      return [];
    },
  } as unknown as BrowserPort;
  const stream = streamBrowserTurn(port, claim, { turnID: 't-late', prompt: 'hello' }, 4, ac.signal);
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /late fragment rejected|aborted/);
});
