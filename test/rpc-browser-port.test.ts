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

test('RPC fixture pins constructor owner against caller mutation after claim', async () => {
  const mutable = { ...binding };
  let calls = 0;
  const port = new RpcBrowserFixturePort(mutable, async () => { calls++; return { accepted: true }; });
  await port.claim(mutable);
  mutable.accountRef = 'impostor';
  await assert.rejects(port.submit(mutable, { turnID: 'test-1', prompt: 'hello' }), /binding|mismatch/i);
  assert.equal(calls, 0);
  await port.release(binding);
});

test('RPC reply arriving after release or same-owner re-claim cannot complete stale work', async () => {
  for (const method of ['submit', 'observe', 'cancel'] as const) {
    for (const reClaim of [false, true]) {
      let entered!: () => void;
      let resume!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      const wait = new Promise<void>((resolve) => { resume = resolve; });
      const rpc = async () => {
        entered();
        await wait;
        return method === 'submit' ? { accepted: true } : method === 'cancel' ? { cancelled: true } :
          { events: [{ seq: 1, kind: 'finished', turnID: 'turn-1' }] };
      };
      const port = new RpcBrowserFixturePort(binding, rpc);
      await port.claim(binding);
      const pending = method === 'submit' ? port.submit(binding, { turnID: 'turn-1', prompt: 'hi' }) :
        method === 'observe' ? port.events(binding, 'turn-1', 0) : port.cancel(binding, 'turn-1');
      await started;
      await port.release(binding);
      if (reClaim) await port.claim(binding);
      resume();
      await assert.rejects(pending, /revoked|expired|binding missing|uncertain/i,
        `method ${method} must not revive pre-release work after ${reClaim ? 'reclaim' : 'release'}`);
      if (reClaim) await port.release(binding);
    }
  }
});
