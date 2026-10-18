import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { exchangeBrowserTurn } from '../src/core/browser-exchange.js';
import { RpcBrowserFixturePort } from '../src/testing/rpc-browser-port.js';
import type { TabClaim } from '../src/core/browser-port.js';

const binding: TabClaim = { accountRef: 'fixture-account', sessionID: 'fixture-session', tabID: 'fixture-tab', providerID: 'qwen' };

test('RPC BrowserPort forwards one prompt and reads only terminal result', async () => {
  const calls: string[] = [];
  const port = new RpcBrowserFixturePort(binding, async (method, input) => {
    calls.push(`${method}:${input.turnID}`);
    return method === 'submit' ? { accepted: true } : { events: [
      { seq: 1, kind: 'text', turnID: input.turnID, value: 'fixture-' },
      { seq: 2, kind: 'text', turnID: input.turnID, value: 'done' },
      { seq: 3, kind: 'finished', turnID: input.turnID },
    ] };
  });
  await port.claim(binding);
  assert.equal(await exchangeBrowserTurn(port, binding, { turnID: 'turn-1', prompt: 'hello' }), 'fixture-done');
  assert.deepEqual(calls, ['submit:turn-1', 'poll:turn-1']);
  assert.equal(await port.cancel(binding), false);
  await port.release(binding);
  await assert.rejects(port.events(binding, 'turn-1', 0), /binding missing/);
});

test('RPC BrowserPort fails closed on spoofed identity, incomplete, and malformed responses', async () => {
  const port = new RpcBrowserFixturePort(binding, async (method) =>
    method === 'submit' ? { accepted: true } : { events: [] });
  await port.claim(binding);
  await assert.rejects(port.submit({ ...binding, accountRef: 'intruder' }, { turnID: 'turn-1', prompt: 'hello' }), /mismatched/);
  await assert.rejects(exchangeBrowserTurn(port, binding, { turnID: 'turn-1', prompt: 'hello' }, 2), /uncertain/);
  await port.release(binding);
  const bad = new RpcBrowserFixturePort(binding, async (method) =>
    method === 'submit' ? { accepted: true } : { events: [{ kind: 'text', seq: 1, turnID: 'turn-2', value: '' }] });
  await bad.claim(binding);
  await assert.rejects(exchangeBrowserTurn(bad, binding, { turnID: 'turn-2', prompt: 'hello' }), /invalid streamed/);
  await bad.release(binding);
});

test('RPC BrowserPort rejects a forged positive result without valid content', async () => {
  for (const invalid of [{ events: [{ seq: 1, kind: 'text', turnID: 'turn-3', value: 1 }] },
    { events: [{ seq: 1, kind: 'text', turnID: 'other', value: 'x' }] }, { events: 'bad' }]) {
    const port = new RpcBrowserFixturePort(binding, async (method) =>
      method === 'submit' ? { accepted: true } : invalid);
    await port.claim(binding);
    await assert.rejects(exchangeBrowserTurn(port, binding, { turnID: 'turn-3', prompt: 'hi' }));
    await port.release(binding);
  }
});
