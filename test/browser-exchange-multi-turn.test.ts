import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exchangeBrowserTurn, streamBrowserTurn } from '../src/core/browser-exchange.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { TabClaim } from '../src/core/browser-port.js';

const claimA: TabClaim = { sessionID: 'sess-multi-a', providerID: 'qwen', tabID: 'tab-multi-a', accountRef: 'acct-a' };
const claimB: TabClaim = { sessionID: 'sess-multi-b', providerID: 'qwen', tabID: 'tab-multi-b', accountRef: 'acct-b' };

test('two successive turns on the same binding produce independent outputs', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claimA);
  const first = await exchangeBrowserTurn(port, claimA, { turnID: 't1', prompt: 'hello' });
  assert.equal(first, 'fixture:hello');
  const second = await exchangeBrowserTurn(port, claimA, { turnID: 't2', prompt: 'world' });
  assert.equal(second, 'fixture:world');
  // Replaying a finished turn must still be rejected (no blind replay).
  await assert.rejects(exchangeBrowserTurn(port, claimA, { turnID: 't1', prompt: 'hello' }), /reconcile before retry/);
  await port.release(claimA);
});

test('streaming two successive turns yields distinct fragments without cross-turn leakage', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claimA);
  const collected1: string[] = [];
  for await (const f of streamBrowserTurn(port, claimA, { turnID: 's1', prompt: 'alpha' })) collected1.push(f);
  assert.deepEqual(collected1, ['fixture:alpha']);
  const collected2: string[] = [];
  for await (const f of streamBrowserTurn(port, claimA, { turnID: 's2', prompt: 'beta' })) collected2.push(f);
  assert.deepEqual(collected2, ['fixture:beta']);
  await port.release(claimA);
});

test('isolated sessions cannot read each other turns events', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claimA);
  await port.claim(claimB);
  await exchangeBrowserTurn(port, claimA, { turnID: 'ta', prompt: 'secret-a' });
  await exchangeBrowserTurn(port, claimB, { turnID: 'tb', prompt: 'secret-b' });
  // B cannot observe A's turn even with a matching turnID guess.
  await assert.rejects(port.events(claimB, 'ta', 0), /unknown turn/);
  // A cannot observe B's turn.
  await assert.rejects(port.events(claimA, 'tb', 0), /unknown turn/);
  await port.release(claimA);
  await port.release(claimB);
});

test('after release the old binding can no longer read its prior turn', async () => {
  const port = new FakeBrowserPort();
  await port.claim(claimA);
  await exchangeBrowserTurn(port, claimA, { turnID: 'tr', prompt: 'x' });
  await port.release(claimA);
  // The stale binding must not reach the (now deleted) turn.
  await assert.rejects(port.events(claimA, 'tr', 0), /tab binding not owned/);
  // A genuinely new binding on a fresh tab may be claimed.
  const fresh: TabClaim = { sessionID: 'sess-fresh', providerID: 'qwen', tabID: 'tab-fresh', accountRef: 'acct-fresh' };
  await port.claim(fresh);
  await port.release(fresh);
});