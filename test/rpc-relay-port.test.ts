import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { RpcRelayPort } from '../src/core/rpc-relay-port.js';
import { exchangeBrowserTurn } from '../src/core/browser-exchange.js';
import type { TabClaim } from '../src/core/browser-port.js';

const binding: TabClaim = { sessionID: 's1', providerID: 'gemini', tabID: 't1', accountRef: 'a1' };
const secret = randomBytes(32).toString('hex');

test('RPC relay waits for a once-only companion response', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  const completion = exchangeBrowserTurn(relay, binding, { turnID: 'turn-1', prompt: 'hello' });
  // submit() is async; wait one microtask for the request to be queued.
  await Promise.resolve();
  assert.deepEqual(relay.take(secret, binding), { turnID: 'turn-1', prompt: 'hello' });
  assert.equal(relay.take(secret, binding), null);
  relay.complete(secret, binding, 'turn-1', 'local page fixture reply');
  assert.equal(await completion, 'local page fixture reply');
  assert.throws(() => relay.complete(secret, binding, 'turn-1', 'duplicate'), /not pending/);
  await relay.release(binding);
});

test('RPC relay forbids spoofing, stolen tokens, ambiguous replay and invalid output', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  await relay.submit(binding, { turnID: 'turn-1', prompt: 'hi' });
  const stolen = randomBytes(32).toString('hex');
  assert.throws(() => relay.take(stolen, binding), /unauthorized/);
  assert.throws(() => relay.take(secret, { ...binding, accountRef: 'other' }), /binding mismatch/);
  await assert.rejects(relay.submit(binding, { turnID: 'turn-1', prompt: 'hi' }), /already submitted/);
  assert.deepEqual(relay.take(secret, binding), { turnID: 'turn-1', prompt: 'hi' });
  assert.equal(await relay.cancel(binding, 'turn-1'), false);
  assert.throws(() => relay.complete(secret, binding, 'turn-1', 'x'.repeat(16_001)), /out of bounds/);
  assert.equal(relay.take(secret, binding), null);
  await assert.rejects(relay.submit(binding, { turnID: 'turn-2', prompt: 'other' }), /already busy/);
  relay.complete(secret, binding, 'turn-1', 'done');
  await relay.release(binding);
  assert.throws(() => relay.take(secret, binding), /binding mismatch/);
});

test('unclaimed relay can be cancelled and never leased afterward', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  await relay.submit(binding, { turnID: 't1', prompt: 'hi' });
  assert.equal(await relay.cancel(binding, 't1'), true);
  assert.equal(relay.take(secret, binding), null);
  assert.deepEqual(await relay.events(binding, 't1', 0), [{ seq: 1, kind: 'cancelled', turnID: 't1' }]);
  await relay.release(binding);
});

test('relay refuses unsupported providers before allocating ownership', async () => {
  const relay = new RpcRelayPort(secret);
  await assert.rejects(relay.claim({ ...binding, providerID: 'unknown' as TabClaim['providerID'] }), /unsupported/);
  await relay.claim(binding);
  await relay.release(binding);
});
