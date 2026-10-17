import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { streamBrowserTurn } from '../src/core/browser-exchange.js';
import type { BrowserPort, TabClaim } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'sess-disc', providerID: 'qwen', tabID: 'tab-disc', accountRef: 'acct-disc' };

test('streamBrowserTurn propagates a mid-stream port disconnect and yields nothing further', async () => {
  let polled = 0;
  const port = {
    submit: async () => {},
    events: async () => {
      polled++;
      if (polled === 1) return [{ seq: 1, kind: 'text', turnID: 't-disc', value: 'partial' }];
      throw new Error('browser disconnected');
    },
  } as unknown as BrowserPort;
  const stream = streamBrowserTurn(port, claim, { turnID: 't-disc', prompt: 'hello' }, 4);
  const first = await stream.next();
  assert.deepEqual(first, { value: 'partial', done: false });
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /browser disconnected/);
});

test('streamBrowserTurn reports uncertain when the stream ends without a terminal event', async () => {
  const port = {
    submit: async () => {},
    events: async () => [],
  } as unknown as BrowserPort;
  const stream = streamBrowserTurn(port, claim, { turnID: 't-unc', prompt: 'hello' }, 2);
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /uncertain/);
});

test('streamBrowserTurn never yields a fragment that follows a cancelled event', async () => {
  const port = {
    submit: async () => {},
    events: async () => [
      { seq: 1, kind: 'text', turnID: 't-cancel', value: 'before' },
      { seq: 2, kind: 'cancelled', turnID: 't-cancel' },
    ],
  } as unknown as BrowserPort;
  const stream = streamBrowserTurn(port, claim, { turnID: 't-cancel', prompt: 'hello' }, 2);
  await assert.rejects(async () => { for await (const _ of stream) { /* none */ } }, /cancelled/);
});