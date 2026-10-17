import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import {
  PROVIDER_POLICY_PROFILES, assessAdapter, advanceAdapterTurn, authorizedAdapterEvents, startAdapterTurn,
  type AdapterContext, type AdapterProgress,
} from '../src/core/provider-adapter-contract.js';
import type { ProviderGate } from '../src/core/provider-gate.js';

const gate: ProviderGate = {
  id: 'qwen', policy: 'permitted', transport: 'verified', browser: 'verified',
  authenticated: true, consented: true, textInput: 'supported', textOutput: 'supported',
  streaming: 'supported', tools: 'supported',
};
const context: AdapterContext = {
  binding: { providerID: 'qwen', sessionID: 'sessionA', tabID: 'tabA', accountRef: 'accountA' },
  gate,
  consent: { providerID: 'qwen', sessionID: 'sessionA', accountRef: 'accountA', turnID: 'turn1',
    approved: true, operation: 'single-text-turn' },
};

test('policy matrix covers every provider and never silently approves automation', () => {
  assert.deepEqual(Object.keys(PROVIDER_POLICY_PROFILES).sort(), WEB_PROVIDER_CATALOG.map((p) => p.id).sort());
  for (const provider of WEB_PROVIDER_CATALOG) {
    const profile = PROVIDER_POLICY_PROFILES[provider.id];
    assert.equal(profile.id, provider.id);
    assert.ok(profile.termsURL.startsWith('https://'));
    assert.notEqual(profile.automatedInput, 'approved');
    assert.notEqual(profile.automatedOutput, 'approved');
    const ctx: AdapterContext = {
      ...context, binding: { ...context.binding, providerID: provider.id },
      gate: { ...gate, id: provider.id },
      consent: { ...context.consent!, providerID: provider.id },
    };
    assert.notEqual(assessAdapter(ctx, 'turn1'), 'ready', provider.id);
  }
});

test('Qwen consumer May 19 2026 terms prohibit automated extraction, not merely unverified', () => {
  const policy = PROVIDER_POLICY_PROFILES.qwen;
  assert.equal(policy.automatedInput, 'prohibited');
  assert.equal(policy.automatedOutput, 'prohibited');
  assert.equal(assessAdapter(context, 'turn1'), 'policy-blocked');
});

test('consent and a forged ready gate cannot override policy; identities cannot cross tenants', () => {
  assert.equal(assessAdapter(context, 'turn1'), 'policy-blocked');
  assert.equal(assessAdapter({ ...context, binding: { ...context.binding, providerID: 'gemini' } }, 'turn1'), 'account-mismatch');
  assert.equal(assessAdapter({ ...context, gate: { ...gate, id: 'chatgpt' } }, 'turn1'), 'account-mismatch');
  const approvedLooking = { ...context, gate: { ...gate, id: 'deepseek' as const },
    binding: { ...context.binding, providerID: 'deepseek' as const },
    consent: { ...context.consent!, providerID: 'deepseek' as const } };
  assert.equal(assessAdapter(approvedLooking, 'turn1'), 'policy-blocked');
  assert.equal(assessAdapter({ ...context, consent: null }, 'turn1'), 'consent-required');
  assert.equal(assessAdapter({ ...context, consent: { ...context.consent!, accountRef: 'accountB' } }, 'turn1'), 'account-mismatch');
  assert.equal(assessAdapter({ ...context, consent: { ...context.consent!, sessionID: 'sessionB' } }, 'turn1'), 'account-mismatch');
  assert.equal(assessAdapter(context, 'turn2'), 'consent-required');
});

test('authorized adapter wrapper never calls a provider on an unresolved policy', async () => {
  let called = 0;
  const adapter = {
    id: 'qwen' as const,
    async inspect() { return 'ready' as const; },
    async *execute() { called++; yield event('complete', 1, 'unsafe'); },
    async abort() { return 'uncertain' as const; },
  };
  const consume = async () => { for await (const _ of authorizedAdapterEvents(adapter, context, { turnID: 'turn1', prompt: 'hi' })) {} };
  await assert.rejects(consume(), /policy-blocked/);
  assert.equal(called, 0);
});

test('an unknown media field or accessor is rejected before reaching even a blocked adapter', async () => {
  let executions = 0;
  const adapter = {
    id: 'qwen' as const,
    async inspect() { return 'ready' as const; },
    async *execute() { executions++; yield event('complete', 1); },
    async abort() { return 'uncertain' as const; },
  };
  const invalid: unknown[] = [
    { turnID: 'turn1', prompt: 'safe', image: { data: 'secret' } },
    Object.defineProperty({ turnID: 'turn1', prompt: 'safe' }, 'attachment',
      { value: 'private', enumerable: false }),
    { turnID: 'turn1', prompt: [{ type: 'image_url', url: 'file:///secret' }] },
    Object.defineProperty({ turnID: 'turn1' }, 'prompt', {
      enumerable: true, get() { throw new Error('untrusted accessor'); },
    }),
  ];
  for (const request of invalid) {
    await assert.rejects(async () => {
      for await (const _ of authorizedAdapterEvents(adapter, context,
        request as { turnID: string; prompt: string })) {}
    }, /unsupported|text prompt|fields|plain/i);
  }
  assert.equal(executions, 0);
});

const event = (kind: AdapterProgress['kind'], seq: number, text = 'text'): AdapterProgress => {
  if (kind === 'partial' || kind === 'complete') return { kind, turnID: 'turn1', seq, text };
  if (kind === 'error') return { kind, turnID: 'turn1', seq, health: 'layout-unknown' };
  return { kind, turnID: 'turn1', seq };
};

test('partial progress is never final and completion requires a terminal transition', () => {
  let state = startAdapterTurn('turn1');
  state = advanceAdapterTurn(state, event('partial', 1, 'hel'));
  assert.equal(state.preview, 'hel');
  assert.equal(state.final, undefined);
  state = advanceAdapterTurn(state, event('complete', 2, 'hello'));
  assert.equal(state.phase, 'completed');
  assert.equal(state.final, 'hello');
  assert.throws(() => advanceAdapterTurn(state, event('partial', 3)), /invalid adapter transition/);
});

test('requested abort stays uncertain until confirmed; no partial can finalize it', () => {
  const pending = advanceAdapterTurn(startAdapterTurn('turn1'), event('abort-requested', 1));
  assert.equal(pending.phase, 'abort-pending');
  assert.throws(() => advanceAdapterTurn(pending, event('complete', 2)), /reconciliation/);
  assert.throws(() => advanceAdapterTurn(pending, event('partial', 2)), /reconciliation/);
  assert.throws(() => advanceAdapterTurn(pending, event('abort-requested', 2)), /invalid abort transition/);
  assert.throws(() => advanceAdapterTurn(startAdapterTurn('turn1'), event('abort-confirmed', 1)), /invalid abort transition/);
  assert.equal(advanceAdapterTurn(pending, event('uncertain', 2)).phase, 'uncertain');
  assert.equal(advanceAdapterTurn(pending, event('abort-confirmed', 2)).phase, 'aborted');
});

test('rejects reordered, foreign and oversized events and fraudulent healthy errors', () => {
  const state = startAdapterTurn('turn1');
  assert.throws(() => advanceAdapterTurn(state, event('partial', 2)), /invalid adapter transition/);
  assert.throws(() => advanceAdapterTurn(state, { ...event('partial', 1), turnID: 'other' }), /invalid adapter transition/);
  assert.throws(() => advanceAdapterTurn(state, event('partial', 1, '')), /invalid partial/);
  assert.throws(() => advanceAdapterTurn(state, event('complete', 1, 'x'.repeat(16_001))), /invalid completion/);
  assert.throws(() => advanceAdapterTurn(state, { kind: 'error', turnID: 'turn1', seq: 1, health: 'ready' }), /healthy/);
  assert.equal(advanceAdapterTurn(state, event('error', 1)).phase, 'failed');
});
