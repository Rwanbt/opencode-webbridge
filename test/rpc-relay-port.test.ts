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

test('relay rejects accessor or hidden claim fields before any auth or durable effect', async () => {
  const relay = new RpcRelayPort(secret);
  let getters = 0;
  const getter = Object.defineProperty({ ...binding }, 'accountRef', {
    enumerable: true, get() { getters++; return 'forged-account'; },
  });
  const hidden = Object.defineProperty({ ...binding }, 'secret', {
    enumerable: false, value: 'sensitive-cookie',
  });
  await assert.rejects(relay.claim(getter), /claim|binding|plain|field/i);
  await assert.rejects(relay.claim(hidden), /claim|binding|plain|field/i);
  assert.equal(getters, 0, 'never evaluate a caller-supplied authority getter');
  await relay.claim(binding);
  assert.throws(() => relay.check(secret, getter), /claim|binding|plain|field/i);
  assert.equal(getters, 0);
  await relay.release(binding);
});

test('ordered progress is visible before finish and never frees the busy lease', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  await relay.submit(binding, { turnID: 'stream-1', prompt: 'hi' });
  relay.take(secret, binding);
  relay.append(secret, binding, 'stream-1', 'hel');
  assert.deepEqual(await relay.events(binding, 'stream-1', 0), [
    { seq: 1, kind: 'text', turnID: 'stream-1', value: 'hel' },
  ]);
  await assert.rejects(relay.submit(binding, { turnID: 'stream-2', prompt: 'must wait' }), /busy/);
  relay.append(secret, binding, 'stream-1', 'lo');
  assert.deepEqual(await relay.events(binding, 'stream-1', 1), [
    { seq: 2, kind: 'text', turnID: 'stream-1', value: 'lo' },
  ]);
  assert.throws(() => relay.complete(secret, binding, 'stream-1', 'not-the-stream'), /mismatch/);
  relay.complete(secret, binding, 'stream-1', 'hello');
  assert.deepEqual(await relay.events(binding, 'stream-1', 2), [
    { seq: 3, kind: 'finished', turnID: 'stream-1' },
  ]);
  assert.throws(() => relay.append(secret, binding, 'stream-1', 'after-finish'), /not pending/);
  assert.throws(() => relay.complete(secret, binding, 'stream-1', 'hello'), /not pending/);
  await relay.submit(binding, { turnID: 'stream-2', prompt: 'now allowed' });
  assert.equal(relay.take(secret, binding)?.turnID, 'stream-2');
  await relay.release(binding);
});

test('progress enforces ownership, lease, size and event count before any mutation', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  await relay.submit(binding, { turnID: 'stream-1', prompt: 'hi' });
  assert.throws(() => relay.append(secret, binding, 'stream-1', 'before-lease'), /not pending/);
  relay.take(secret, binding);
  assert.throws(() => relay.append(secret, { ...binding, accountRef: 'wrong' }, 'stream-1', 'x'), /binding/);
  assert.throws(() => relay.append(secret, binding, 'stream-1', ''), /out of bounds/);
  assert.throws(() => relay.append(secret, binding, 'stream-1', 'x'.repeat(16_001)), /out of bounds/);
  for (let i = 0; i < 62; i++) relay.append(secret, binding, 'stream-1', 'x');
  assert.throws(() => relay.append(secret, binding, 'stream-1', 'x'), /out of bounds/);
  relay.complete(secret, binding, 'stream-1', 'x'.repeat(62));
  assert.equal((await relay.events(binding, 'stream-1', 0)).length, 63);
  await relay.release(binding);
});

test('observe with a consumed cursor waits for the NEXT event instead of spinning empty', async () => {
  const relay = new RpcRelayPort(secret);
  await relay.claim(binding);
  await relay.submit(binding, { turnID: 'progress-wait', prompt: 'hello' });
  relay.take(secret, binding);
  relay.append(secret, binding, 'progress-wait', 'first');
  assert.equal((await relay.events(binding, 'progress-wait', 0)).length, 1);
  let returned = false;
  const next = relay.events(binding, 'progress-wait', 1).then((events) => { returned = true; return events; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(returned, false, 'consumed cursor must block until newer progress/terminal event');
  relay.append(secret, binding, 'progress-wait', '-second');
  assert.deepEqual(await next, [
    { seq: 2, kind: 'text', turnID: 'progress-wait', value: '-second' },
  ]);
  relay.complete(secret, binding, 'progress-wait', 'first-second');
  await relay.release(binding);
});
