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
    if (method === 'cancel') return { cancelled: false };
    return method === 'submit' ? { accepted: true } : { events: [
      { seq: 1, kind: 'text', turnID: input.turnID, value: 'fixture-done' },
      { seq: 2, kind: 'finished', turnID: input.turnID },
    ] };
  });
  await port.claim(binding);
  assert.equal(await exchangeBrowserTurn(port, binding, { turnID: 'turn-1', prompt: 'hello' }), 'fixture-done');
  assert.deepEqual(calls, ['submit:turn-1', 'observe:turn-1']);
  assert.equal(await port.cancel(binding, 'turn-1'), false);
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
    method === 'submit' ? { accepted: true } : { events: [
      { seq: 1, kind: 'text', turnID: 'turn-2', value: '' },
      { seq: 2, kind: 'finished', turnID: 'turn-2' },
    ] });
  await bad.claim(binding);
  await assert.rejects(exchangeBrowserTurn(bad, binding, { turnID: 'turn-2', prompt: 'hello' }), /empty browser answer/);
  await bad.release(binding);
});

test('RPC BrowserPort rejects malformed or cross-turn streamed events', async () => {
  for (const invalid of [{ finished: true }, { events: 'oops' }, { events: [
    { seq: 1, kind: 'text', turnID: 'other', value: 'x' },
  ] }]) {
    const port = new RpcBrowserFixturePort(binding, async (method) =>
      method === 'submit' ? { accepted: true } : invalid);
    await port.claim(binding);
    await assert.rejects(exchangeBrowserTurn(port, binding, { turnID: 'turn-3', prompt: 'hi' }));
    await port.release(binding);
  }
});

test('pre-lease cancel uses the authenticated RPC and reports an uncertain lease honestly', async () => {
  const requests: string[] = [];
  const port = new RpcBrowserFixturePort(binding, async (method, input) => {
    requests.push(`${method}:${input.turnID}`);
    if (method === 'cancel') return { cancelled: input.turnID === 'queued' };
    return { accepted: true };
  });
  await port.claim(binding);
  assert.equal(await port.cancel(binding, 'queued'), true);
  assert.equal(await port.cancel(binding, 'leased'), false, 'cannot claim remote effect stopped');
  assert.deepEqual(requests, ['cancel:queued', 'cancel:leased']);
  await assert.rejects(port.cancel({ ...binding, tabID: 'other' }, 'queued'), /binding/);
  await port.release(binding);
});

test('malformed cancellation acknowledgement must fail closed', async () => {
  for (const invalid of [{ cancelled: 'yes' }, { accepted: true }, null]) {
    const port = new RpcBrowserFixturePort(binding, async () => invalid);
    await port.claim(binding);
    await assert.rejects(port.cancel(binding, 'queued'), /malformed RPC cancellation/);
    await port.release(binding);
  }
});
