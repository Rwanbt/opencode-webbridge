import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { createG158CompletionGate, createG158DeferredCompanion } from './g152-root-vertical-host.mjs';

test('G158 duplicate completion waits past old 5-second race without second tool effect', async () => {
  const gate = createG158CompletionGate(20_000);
  let firstEffects = 0, secondEffects = 0;
  let companionStarts = 0;
  const companion = createG158DeferredCompanion(async () => { companionStarts++; });
  const first = (async () => {
    firstEffects++;
    await delay(7_500); // exceeds BOTH former 5s duplicate and 7.2s premature companion polling windows
    assert.equal(companion.started, false, 'DOM polling started before native RPC submit');
    assert.equal(companionStarts, 0);
    await companion.start();
    gate.succeed();
  })();
  const second = (async () => {
    await gate.wait(); // must use first outcome, never reenter Git/DOM
    assert.equal(firstEffects, 1);
    assert.equal(secondEffects, 0);
  })();
  await Promise.all([first, second]);
  assert.equal(firstEffects, 1);
  assert.equal(companionStarts, 1);
  assert.throws(() => companion.start(), /already started/);
});

test('G158 upstream companion failure unblocks duplicate immediately, never grants success', async () => {
  const gate = createG158CompletionGate(5_000);
  const wait = gate.wait();
  gate.fail();
  await assert.rejects(wait, /first native model turn failed/);
  await assert.rejects(gate.wait(), /first native model turn failed/);
  gate.succeed(); // late first-turn success cannot reverse the failure tombstone
  await assert.rejects(gate.wait(), /first native model turn failed/);
});

test('G158 unresolved first turn fails with bounded explicit reconciliation, no blind replay', async () => {
  const gate = createG158CompletionGate(110);
  await assert.rejects(gate.wait(), /unresolved.*reconcile/);
  assert.throws(() => createG158CompletionGate(0), /invalid.*budget/);
});
