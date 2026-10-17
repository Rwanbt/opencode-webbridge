import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../src/catalog.js';
import { disabledGate } from '../src/core/provider-gate.js';
import type { AdapterContext } from '../src/core/provider-adapter-contract.js';
import { OfflineAccountAdapterHarness, classifyOfflineHealth } from '../src/testing/offline-account-adapter.js';

const setup = (providerID: WebProviderID, suffix: string): [OfflineAccountAdapterHarness, AdapterContext] => {
  const h = new OfflineAccountAdapterHarness();
  const binding = { providerID, accountRef: `account_${suffix}`, sessionID: `session_${suffix}`, tabID: `tab_${suffix}` };
  h.claim(binding);
  return [h, { binding, gate: disabledGate(providerID), consent: {
    providerID, accountRef: binding.accountRef, sessionID: binding.sessionID,
    turnID: 'turn_A', operation: 'single-text-turn', approved: true,
  } }];
};

test('five offline profiles need explicit manual login after manual-flow request, never unlock gate', async () => {
  for (const { id } of WEB_PROVIDER_CATALOG) {
    const [h, ctx] = setup(id, id);
    assert.deepEqual(h.manualLoginStatus(ctx.binding), 'not-requested');
    h.beginManualLogin(ctx.binding);
    assert.equal(h.manualLoginStatus(ctx.binding), 'awaiting-human');
    h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    assert.equal(h.status(ctx.binding).health, 'authentication-required');
    assert.throws(() => h.openTrace(ctx, 'turn_A'), /blocked/);
    h.confirmManualLogin(ctx.binding);
    assert.equal(h.manualLoginStatus(ctx.binding), 'confirmed');
    assert.equal(h.status(ctx.binding).health, 'ready');
    assert.notEqual(await h.adapter(id).inspect(ctx), 'ready');
    await assert.rejects(async () => {
      for await (const _ of h.adapter(id).execute(ctx, { turnID: 'turn_A', prompt: 'never sent' })) {}
    }, /offline fixture cannot execute/);
  }
});

test('challenge and disconnection require explicit manual reconnect, stale source revisions are refused', () => {
  const [h, ctx] = setup('gemini', 'recover');
  h.beginManualLogin(ctx.binding);
  h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  h.confirmManualLogin(ctx.binding);
  h.observe(ctx.binding, 'fixture-dom', 1, 'challenge');
  assert.equal(h.status(ctx.binding).health, 'challenge-human-required');
  h.beginReconnect(ctx.binding);
  assert.equal(h.status(ctx.binding).health, 'authentication-required');
  assert.throws(() => h.confirmManualLogin(ctx.binding), /signed-in/);
  assert.throws(() => h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in'), /stale/);
  h.observe(ctx.binding, 'fixture-ui', 2, 'signed-in');
  h.confirmManualLogin(ctx.binding);
  assert.equal(h.status(ctx.binding).health, 'ready');
  h.observe(ctx.binding, 'fixture-dom', 2, 'expired');
  assert.throws(() => h.beginReconnect(ctx.binding), /reclaim/);
  h.release(ctx.binding);
  h.claim(ctx.binding);
  assert.equal(h.manualLoginStatus(ctx.binding), 'not-requested');
});

test('manual login requires NEW evidence, never a cached signed-in observation', () => {
  const [h, ctx] = setup('chatgpt', 'fresh');
  h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  h.openTrace(ctx, 'turn_A');
  h.beginManualLogin(ctx.binding);
  assert.equal(h.turnDiagnostics(ctx.binding, 'turn_A').phase, 'uncertain');
  assert.equal(h.status(ctx.binding).health, 'authentication-required');
  assert.throws(() => h.confirmManualLogin(ctx.binding), /fresh signed-in/);
  assert.throws(() => h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in'), /stale/);
  h.observe(ctx.binding, 'fixture-ui', 2, 'signed-in');
  h.confirmManualLogin(ctx.binding);
  assert.throws(() => h.openTrace(ctx, 'turn_A'), /reconcile before retry/);
});

test('simulated manual logout/expiry reports terminal state without silent reauthentication', () => {
  for (const status of ['signed-out', 'expired'] as const) {
    const [h, ctx] = setup('deepseek', `logout_${status}`);
    h.beginManualLogin(ctx.binding);
    h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    h.confirmManualLogin(ctx.binding);
    h.observe(ctx.binding, 'fixture-ui', 2, status);
    assert.equal(h.manualLoginStatus(ctx.binding), status);
    assert.equal(h.sessionDiagnostics(ctx.binding).category, 'auth');
    h.observe(ctx.binding, 'fixture-ui', 3, 'signed-in');
    assert.equal(h.manualLoginStatus(ctx.binding), status);
    assert.notEqual(h.sessionDiagnostics(ctx.binding).health, 'ready');
    assert.throws(() => h.confirmManualLogin(ctx.binding), /fresh signed-in/);
    assert.throws(() => h.beginReconnect(ctx.binding), /reclaim/);
  }
});

test('reconnect never converts an in-flight or abort-pending turn to final', () => {
  const [h, ctx] = setup('qwen', 'stream');
  h.beginManualLogin(ctx.binding);
  h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  h.confirmManualLogin(ctx.binding);
  h.openTrace(ctx, 'turn_A');
  h.trace(ctx, { kind: 'partial', turnID: 'turn_A', seq: 1, text: 'sensitive preview' });
  h.requestAbort(ctx, 'turn_A');
  h.observe(ctx.binding, 'fixture-dom', 1, 'disconnected');
  assert.equal(h.turnDiagnostics(ctx.binding, 'turn_A').phase, 'uncertain');
  assert.equal(JSON.stringify(h.turnDiagnostics(ctx.binding, 'turn_A')).includes('sensitive preview'), false);
  h.beginReconnect(ctx.binding);
  h.observe(ctx.binding, 'fixture-ui', 2, 'signed-in');
  h.confirmManualLogin(ctx.binding);
  assert.throws(() => h.openTrace(ctx, 'turn_A'), /reconcile before retry/);
  assert.throws(() => h.trace(ctx, { kind: 'complete', turnID: 'turn_A', seq: 4, text: 'fake' }), /transition/);
});

test('restart requires exact owner, keeps turn IDs as uncertain tombstones and never replays', () => {
  for (const { id } of WEB_PROVIDER_CATALOG) {
    const [h, ctx] = setup(id, `restart_${id}`);
    h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    h.openTrace(ctx, 'turn_A');
    h.trace(ctx, { kind: 'partial', turnID: 'turn_A', seq: 1, text: 'not durable' });
    const checkpoint = h.checkpoint(ctx.binding);
    const next = new OfflineAccountAdapterHarness();
    next.claim(ctx.binding);
    assert.throws(() => next.recover({ ...ctx.binding, accountRef: 'wrong' }, checkpoint), /ownership/);
    assert.throws(() => next.recover(ctx.binding, { ...checkpoint, turns: [{ turnID: '../bad', seq: 1 }] }), /invalid/);
    next.recover(ctx.binding, checkpoint);
    assert.equal(next.status(ctx.binding).health, 'authentication-required');
    assert.equal(next.turnDiagnostics(ctx.binding, 'turn_A').phase, 'uncertain');
    assert.equal(next.turnDiagnostics(ctx.binding, 'turn_A').previewLength, 0);
    assert.throws(() => next.openTrace(ctx, 'turn_A'), /blocked|reconcile before retry/);
    next.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
    assert.throws(() => next.openTrace(ctx, 'turn_A'), /reconcile before retry/);
    next.reconcile(ctx.binding, 'turn_A', 'evidence_manual', 'effect-unverified');
    assert.equal(next.turnDiagnostics(ctx.binding, 'turn_A').review, 'effect-unverified');
    assert.throws(() => next.reconcile(ctx.binding, 'turn_A', 'evidence_2', 'observed-effect'), /already reviewed/);
    assert.throws(() => next.openTrace(ctx, 'turn_A'), /reconcile before retry/);
  }
});

test('diagnostics and error taxonomy never leak streamed text, handles or credentials', () => {
  const [h, ctx] = setup('deepseek', 'errors');
  h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  h.openTrace(ctx, 'turn_A');
  h.trace(ctx, { kind: 'partial', turnID: 'turn_A', seq: 1, text: 'never-visible-output' });
  h.trace(ctx, { kind: 'error', turnID: 'turn_A', seq: 2, health: 'rate-limited' });
  const info = h.turnDiagnostics(ctx.binding, 'turn_A');
  assert.equal(h.sessionDiagnostics(ctx.binding).totalTurns, 1);
  assert.equal(h.sessionDiagnostics(ctx.binding).pendingTurns, 0);
  assert.equal(info.phase, 'failed');
  assert.equal(info.error, 'rate-limited');
  assert.equal(info.category, 'quota');
  assert.equal(info.previewLength, 'never-visible-output'.length);
  assert.equal(JSON.stringify(info).includes('never-visible-output'), false);
  assert.equal(classifyOfflineHealth('challenge-human-required'), 'challenge');
  assert.equal(classifyOfflineHealth('policy-blocked'), 'policy');
  assert.equal(classifyOfflineHealth('turn-uncertain'), 'uncertain');
  assert.throws(() => h.turnDiagnostics({ ...ctx.binding, accountRef: 'other' }, 'turn_A'), /ownership/);
  assert.throws(() => h.reconcile(ctx.binding, 'turn_A', 'evidence_X', 'observed-effect'), /not uncertain/);
});

test('checkpoint validation is atomic and settles no completed reply as trusted after recovery', () => {
  const [h, ctx] = setup('mistral', 'checkpoint');
  h.observe(ctx.binding, 'fixture-ui', 1, 'signed-in');
  h.openTrace(ctx, 'turn_A');
  h.trace(ctx, { kind: 'complete', turnID: 'turn_A', seq: 1, text: 'secret-final' });
  const checkpoint = h.checkpoint(ctx.binding);
  assert.equal(JSON.stringify(checkpoint).includes('secret-final'), false);
  const restarted = new OfflineAccountAdapterHarness();
  restarted.claim(ctx.binding);
  assert.throws(() => restarted.recover(ctx.binding, { ...checkpoint, turns: [
    { turnID: 'turn_A', seq: 1 }, { turnID: 'turn_A', seq: 2 },
  ] }), /invalid/);
  restarted.recover(ctx.binding, checkpoint);
  assert.equal(restarted.turnDiagnostics(ctx.binding, 'turn_A').phase, 'uncertain');
  assert.equal(restarted.turnDiagnostics(ctx.binding, 'turn_A').completed, false);
  assert.throws(() => restarted.release(ctx.binding), /unresolved/);
  assert.throws(() => restarted.reconcile({ ...ctx.binding, tabID: 'other' },
    'turn_A', 'evidence_manual', 'observed-effect'), /ownership/);
});
