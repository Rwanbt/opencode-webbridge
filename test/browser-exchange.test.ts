import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exchangeBrowserTurn } from '../src/core/browser-exchange.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { BrowserPort, TabClaim, TurnEvent, TurnRequest } from '../src/core/browser-port.js';

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

test('text-only input preflight rejects hidden media, extra keys and accessors BEFORE submit', async () => {
  let sends = 0;
  const port = { submit: async () => { sends++; }, events: async () => [] } as unknown as BrowserPort;
  const accessor = Object.defineProperty({ turnID: 't1' }, 'prompt', {
    enumerable: true, get() { throw new Error('accessor should never run'); },
  });
  const hidden = Object.defineProperty({ turnID: 't1', prompt: 'hello' }, 'attachment', {
    enumerable: false, value: 'sensitive-image-data',
  });
  const samples: unknown[] = [
    { turnID: 't1', prompt: 'hello', attachments: [{ data: 'private' }] },
    { turnID: 't1', prompt: 'hello', image_url: 'file:///private' },
    { turnID: 't1', prompt: '' },
    { turnID: 't1', prompt: 'x'.repeat(16_001) },
    { turnID: 'invalid id', prompt: 'hello' },
    accessor, hidden, Object.assign(Object.create({ inherited: true }), turn),
  ];
  for (const request of samples) {
    await assert.rejects(exchangeBrowserTurn(port, claim, request as TurnRequest, 1));
  }
  assert.equal(sends, 0, 'no invalid multimodal payload may reach the browser');
});

test('browser exchange captures immutable owner and turn before asynchronous transport', async () => {
  const mutableClaim = { ...claim };
  const mutableTurn = { ...turn };
  let reads = 0;
  const port = {
    submit: async (owner: TabClaim, request: TurnRequest) => {
      assert.notStrictEqual(owner, mutableClaim, 'transport cannot hold the caller-owned mutable authority');
      assert.notStrictEqual(request, mutableTurn, 'transport cannot hold the caller-owned mutable turn');
      assert.equal(Object.isFrozen(owner), true);
      assert.equal(Object.isFrozen(request), true);
      mutableClaim.sessionID = 'victim-session';
      mutableClaim.tabID = 'victim-tab';
      mutableTurn.turnID = 'victim-turn';
    },
    events: async (owner: TabClaim, turnID: string) => {
      reads++;
      assert.deepEqual(owner, claim, 'reads must retain original session and tab');
      assert.equal(turnID, turn.turnID, 'reads must retain original turn');
      return [{ seq: 1, kind: 'text', turnID, value: 'safe' },
        { seq: 2, kind: 'finished', turnID }];
    },
  } as unknown as BrowserPort;
  assert.equal(await exchangeBrowserTurn(port, mutableClaim, mutableTurn), 'safe');
  assert.equal(reads, 1);
});

test('browser exchange refuses untrusted claim getters and unexpected fields before submit', async () => {
  let sends = 0;
  const port = { submit: async () => { sends++; }, events: async () => [] } as unknown as BrowserPort;
  const getter = Object.defineProperty({ ...claim }, 'tabID', {
    enumerable: true, get() { throw new Error('secret credential getter evaluated'); },
  });
  const extra = Object.defineProperty({ ...claim }, 'hiddenAuthority', {
    enumerable: false, value: 'different-account',
  });
  for (const invalid of [getter, extra, { ...claim, providerID: 'unregistered' }]) {
    await assert.rejects(exchangeBrowserTurn(port, invalid as TabClaim, turn), /claim|binding|provider/i);
  }
  assert.equal(sends, 0);
});
