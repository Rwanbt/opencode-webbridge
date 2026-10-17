import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exchangeBrowserTurn, streamBrowserTurn } from '../src/core/browser-exchange.js';
import { RpcRelayPort } from '../src/core/rpc-relay-port.js';
import { randomBytes } from 'node:crypto';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { BrowserPort, TabClaim, TurnEvent } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'sess-1', providerID: 'qwen', tabID: 'tab-1', accountRef: 'acct-1' };
const turn = { turnID: 'turn-1', prompt: 'hello' };

test('browser exchange returns the settled content without retrying the send', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claim);
  assert.equal(await exchangeBrowserTurn(port, claim, turn), 'fixture:hello');
  await assert.rejects(exchangeBrowserTurn(port, claim, turn), /reconcile before retry/);
  await port.release(claim);
});

test('stream generator yields actual progressive fragments before terminal without resending', async () => {
  const secret = randomBytes(32).toString('hex');
  const port = new RpcRelayPort(secret);
  await port.claim(claim);
  const stream = streamBrowserTurn(port, claim, { turnID: 'stream-1', prompt: 'hello' }, 16);
  const first = stream.next();
  await Promise.resolve();
  assert.deepEqual(port.take(secret, claim), { turnID: 'stream-1', prompt: 'hello' });
  port.progress(secret, claim, 'stream-1', 1, 'before ');
  assert.deepEqual(await first, { value: 'before ', done: false });
  const second = stream.next();
  port.progress(secret, claim, 'stream-1', 2, 'terminal');
  assert.deepEqual(await second, { value: 'terminal', done: false });
  port.complete(secret, claim, 'stream-1', 'before terminal');
  assert.deepEqual(await stream.next(), { value: undefined, done: true });
  assert.equal(port.take(secret, claim), null);
  await port.release(claim);
});

test('browser exchange rejects forged/duplicate/oversized/unfinished events', async () => {
  const scenarios: Array<readonly TurnEvent[]> = [
    [{ seq: 2, kind: 'finished', turnID: 'turn-1' }],
    [{ seq: 1, kind: 'finished', turnID: 'forged' }],
    [{ seq: 1, kind: 'text', turnID: 'turn-1', value: 'x'.repeat(16_001) }],
    [{ seq: 1, kind: 'cancelled', turnID: 'turn-1' }],
    [{ seq: 1, kind: 'finished', turnID: 'turn-1' }],
    [{ seq: 1, kind: 'text', turnID: 'turn-1', value: 'partial' }],
    [{ seq: 1, kind: 'finished', turnID: 'turn-1' }, { seq: 2, kind: 'text', turnID: 'turn-1', value: 'after' }],
  ];
  for (const events of scenarios) {
    let sends = 0;
    const port = {
      submit: async () => { sends++; },
      events: async (_binding: TabClaim, _id: string, after: number) => after === 0 ? events : [],
    } as unknown as BrowserPort;
    await assert.rejects(exchangeBrowserTurn(port, claim, turn, 2));
    assert.equal(sends, 1);
  }
});

test('pre-aborted browser request cannot dispatch and never attempts cancellation', async () => {
  let sends = 0;
  let cancels = 0;
  const port = { submit: async () => { sends++; }, cancel: async () => { cancels++; return true; } } as unknown as BrowserPort;
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(exchangeBrowserTurn(port, claim, { turnID: 'pre-abort', prompt: 'do not send' }, 4,
    abort.signal), /interrupted.*uncertain/);
  assert.equal(sends, 0);
  assert.equal(cancels, 0);
});

test('disconnect while submit ACK is pending returns uncertain without re-dispatch', async () => {
  let sends = 0;
  let cancels = 0;
  const port = {
    submit: async () => { sends++; return new Promise<never>(() => {}); },
    cancel: async () => { cancels++; throw new Error('claimed turn cannot be reversed'); },
  } as unknown as BrowserPort;
  const abort = new AbortController();
  const pending = exchangeBrowserTurn(port, claim, { turnID: 'ack-pending', prompt: 'hello' }, 4, abort.signal);
  await Promise.resolve();
  assert.equal(sends, 1);
  abort.abort();
  await assert.rejects(pending, /interrupted.*uncertain/);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(cancels, 1);
  assert.equal(sends, 1);
});
