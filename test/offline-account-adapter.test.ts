import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import { authorizedAdapterEvents, type AdapterContext } from '../src/core/provider-adapter-contract.js';
import { disabledGate } from '../src/core/provider-gate.js';
import { OfflineAccountAdapterHarness } from '../src/testing/offline-account-adapter.js';

const context = (providerID: (typeof WEB_PROVIDER_CATALOG)[number]['id'], suffix: string): AdapterContext => ({
  binding: { providerID, tabID: `tab_${suffix}`, sessionID: `session_${suffix}`, accountRef: `account_${suffix}` },
  gate: disabledGate(providerID),
  consent: { providerID, accountRef: `account_${suffix}`, sessionID: `session_${suffix}`,
    turnID: 'turn1', operation: 'single-text-turn', approved: true },
});

test('all five signed-in fixture accounts still have blocked policy and zero adapter calls', async () => {
  const fixture = new OfflineAccountAdapterHarness();
  for (const provider of WEB_PROVIDER_CATALOG) {
    const ctx = context(provider.id, provider.id);
    const adapter = fixture.adapter(provider.id);
    fixture.claim(ctx.binding);
    assert.equal(await adapter.inspect(ctx), 'authentication-required');
    fixture.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    assert.deepEqual(fixture.status(ctx.binding), { health: 'ready', source: 'fixture-ui' });
    const policy = provider.id === 'gemini' || provider.id === 'qwen' ? 'review-required' : 'policy-blocked';
    assert.equal(await adapter.inspect(ctx), policy);
    await assert.rejects(async () => {
      for await (const _ of authorizedAdapterEvents(adapter, ctx, { turnID: 'turn1', prompt: 'fixture only' })) {}
    }, new RegExp(policy));
    await assert.rejects(async () => {
      for await (const _ of adapter.execute(ctx, { turnID: 'turn1', prompt: 'fixture only' })) {}
    }, /offline fixture cannot execute/);
    fixture.observe(ctx.binding, 'fixture-ui', 2, 'signed-out');
    assert.equal(await adapter.inspect(ctx), 'authentication-required');
    // No silent re-login or reuse of a revoked session, even with a newer signal.
    fixture.observe(ctx.binding, 'fixture-ui', 3, 'signed-in');
    assert.equal(fixture.status(ctx.binding).health, 'authentication-required');
    fixture.release(ctx.binding);
    assert.throws(() => fixture.status(ctx.binding), /ownership mismatch/);
  }
});

test('each blocked profile surfaces challenge, rate limit and expiry without reauthenticating', async () => {
  for (const provider of WEB_PROVIDER_CATALOG) {
    const fixture = new OfflineAccountAdapterHarness();
    const ctx = context(provider.id, `fault_${provider.id}`);
    fixture.claim(ctx.binding);
    fixture.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    fixture.observe(ctx.binding, 'fixture-ui', 2, 'challenge');
    assert.equal(await fixture.adapter(provider.id).inspect(ctx), 'challenge-human-required');
    fixture.observe(ctx.binding, 'fixture-ui', 3, 'rate-limited');
    assert.equal(await fixture.adapter(provider.id).inspect(ctx), 'rate-limited');
    fixture.observe(ctx.binding, 'fixture-ui', 4, 'expired');
    assert.equal(await fixture.adapter(provider.id).inspect(ctx), 'session-expired');
    fixture.observe(ctx.binding, 'fixture-ui', 5, 'signed-in');
    assert.equal(await fixture.adapter(provider.id).inspect(ctx), 'session-expired');
  }
});

test('tab, session, account and provider are a single owned lease', () => {
  const fixture = new OfflineAccountAdapterHarness();
  const a = context('chatgpt', 'A');
  const b = context('deepseek', 'B');
  fixture.claim(a.binding);
  fixture.claim(b.binding);
  assert.throws(() => fixture.claim({ ...b.binding, tabID: a.binding.tabID }), /already owned/);
  assert.throws(() => fixture.claim({ ...b.binding, sessionID: a.binding.sessionID }), /already owned/);
  for (const claim of [
    { ...a.binding, accountRef: b.binding.accountRef },
    { ...a.binding, providerID: b.binding.providerID },
    { ...a.binding, sessionID: b.binding.sessionID },
    { ...a.binding, tabID: b.binding.tabID },
  ]) {
    assert.throws(() => fixture.observe(claim, 'fixture-ui', 1, 'signed-in'), /ownership mismatch/);
    assert.throws(() => fixture.release(claim), /ownership mismatch/);
  }
  assert.equal(fixture.status(b.binding).health, 'authentication-required');
  fixture.release(a.binding);
  fixture.claim(a.binding);
  assert.equal(fixture.status(a.binding).health, 'authentication-required');
});

test('restrictive sources outrank login guesses, higher source wins competing blockers', () => {
  const fixture = new OfflineAccountAdapterHarness();
  const ctx = context('gemini', 'signals');
  fixture.claim(ctx.binding);
  fixture.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  fixture.observe(ctx.binding, 'fixture-cache', 1, 'challenge');
  assert.deepEqual(fixture.status(ctx.binding), { health: 'challenge-human-required', source: 'fixture-cache' });
  fixture.observe(ctx.binding, 'fixture-dom', 1, 'disconnected');
  assert.deepEqual(fixture.status(ctx.binding), { health: 'disconnected', source: 'fixture-dom' });
  fixture.observe(ctx.binding, 'fixture-ui', 2, 'rate-limited');
  assert.deepEqual(fixture.status(ctx.binding), { health: 'rate-limited', source: 'fixture-ui' });
  assert.throws(() => fixture.observe(ctx.binding, 'fixture-cache', 1, 'signed-in'), /stale/);
  fixture.observe(ctx.binding, 'fixture-ui', 3, 'signed-in');
  assert.equal(fixture.status(ctx.binding).health, 'disconnected');
  fixture.observe(ctx.binding, 'fixture-dom', 2, 'signed-in');
  assert.equal(fixture.status(ctx.binding).health, 'challenge-human-required');
  fixture.observe(ctx.binding, 'fixture-cache', 2, 'signed-in');
  assert.equal(fixture.status(ctx.binding).health, 'ready');
});

test('per-turn consent binds traces and prevents a different account or turn observing progress', () => {
  const fixture = new OfflineAccountAdapterHarness();
  const ctx = context('qwen', 'owner');
  fixture.claim(ctx.binding);
  fixture.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  assert.throws(() => fixture.openTrace({ ...ctx, consent: null }, 'turn1'), /consent/);
  assert.throws(() => fixture.openTrace(ctx, 'turn2'), /consent/);
  assert.throws(() => fixture.openTrace({ ...ctx, consent: { ...ctx.consent!, accountRef: 'other' } }, 'turn1'), /consent/);
  assert.throws(() => fixture.openTrace({ ...ctx, gate: disabledGate('gemini') }, 'turn1'), /consent/);
  fixture.openTrace(ctx, 'turn1'); // purely local test progress, no prompt sent
  assert.throws(() => fixture.openTrace(ctx, 'turn1'), /reconcile before retry/);
  assert.throws(() => fixture.trace({ ...ctx, consent: null },
    { kind: 'partial', turnID: 'turn1', seq: 1, text: 'a' }), /consent/);
  assert.throws(() => fixture.trace({ ...ctx, consent: { ...ctx.consent!, accountRef: 'other' } },
    { kind: 'partial', turnID: 'turn1', seq: 1, text: 'a' }), /consent/);
  assert.throws(() => fixture.requestAbort({ ...ctx, consent: null }, 'turn1'), /consent/);
  assert.equal(fixture.trace(ctx, { kind: 'partial', turnID: 'turn1', seq: 1, text: 'a' }).final, undefined);
  assert.equal(fixture.trace(ctx, { kind: 'complete', turnID: 'turn1', seq: 2, text: 'answer' }).final, 'answer');
  assert.throws(() => fixture.trace(ctx, { kind: 'partial', turnID: 'turn1', seq: 3, text: 'replay' }), /transition/);
});

test('abort remains uncertain until explicitly confirmed; expiry invalidates in-flight state', async () => {
  const fixture = new OfflineAccountAdapterHarness();
  const ctx = context('mistral', 'abort');
  fixture.claim(ctx.binding);
  fixture.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  fixture.openTrace(ctx, 'turn1');
  const adapter = fixture.adapter('mistral');
  assert.equal(await adapter.abort(ctx, 'turn1'), 'uncertain');
  assert.equal(await adapter.abort(ctx, 'turn1'), 'uncertain');
  assert.throws(() => fixture.trace(ctx,
    { kind: 'complete', turnID: 'turn1', seq: 2, text: 'late answer' }), /reconciliation/);
  assert.equal(fixture.trace(ctx, { kind: 'abort-confirmed', turnID: 'turn1', seq: 2 }).phase, 'aborted');
  assert.equal(await adapter.abort(ctx, 'turn1'), 'confirmed');
  const second = { ...ctx, consent: { ...ctx.consent!, turnID: 'turn2' } };
  fixture.openTrace(second, 'turn2');
  fixture.observe(ctx.binding, 'fixture-ui', 2, 'expired');
  assert.equal(fixture.status(ctx.binding).health, 'session-expired');
  assert.equal(await adapter.abort(second, 'turn2'), 'uncertain');
  assert.throws(() => fixture.trace(second,
    { kind: 'complete', turnID: 'turn2', seq: 2, text: 'late answer' }), /fixture account blocked/);
  fixture.observe(ctx.binding, 'fixture-ui', 3, 'signed-in');
  assert.equal(fixture.status(ctx.binding).health, 'session-expired');
});
