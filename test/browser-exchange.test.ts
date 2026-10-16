import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exchangeBrowserTurn } from '../src/core/browser-exchange.js';
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
