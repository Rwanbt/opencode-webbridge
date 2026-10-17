import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { Plugin } from '@opencode/plugin';
import { BrowserHostCapability } from '../src/core/browser-host-capability.js';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { TabClaim } from '../src/core/browser-port.js';

// SDK v2.0.29 compatibility witness: RPC and permission are public, browser is not.
type Present<Key extends PropertyKey> = Key extends keyof Plugin.Context ? true : false;
const sdk: { rpc: Present<'rpc'>; permission: Present<'permission'>; browser: Present<'browser'> } = {
  rpc: true, permission: true, browser: false,
};

const binding: TabClaim = {
  sessionID: 'session_one', providerID: 'qwen', tabID: 'tab_one', accountRef: 'fixture_account',
};

function fixture(denied?: string) {
  const calls: string[] = [];
  const assertions = {
    assert: async (input: { action: string; resources: readonly string[] }) => {
      calls.push(`${input.action}:${input.resources.join(',')}`);
      if (input.action === denied) throw new Error(`denied: ${denied}`);
    },
  } as unknown as Pick<Plugin.Context['permission'], 'assert'>;
  const gate = new BrowserHostCapability(assertions);
  const port = new FakeBrowserPort();
  let consent = true;
  const unregister = gate.register({ binding, port, consented: async () => consent });
  return { gate, port, calls, unregister, revoke: () => { consent = false; } };
}

test('OpenCode v2 plugin type exposes RPC and permissions, but no public browser context', () => {
  assert.deepEqual(sdk, { rpc: true, permission: true, browser: false });
});

test('unregistered host and mismatched ownership reject before permission and browser calls', async () => {
  const calls: string[] = [];
  const gate = new BrowserHostCapability({ assert: async () => { calls.push('assert'); } });
  await assert.rejects(gate.claim(binding), /unavailable/);
  const host = fixture();
  await assert.rejects(host.gate.claim({ ...binding, accountRef: 'other' }), /owner mismatch/);
  assert.deepEqual(calls, []);
  assert.deepEqual(host.calls, []);
  host.unregister();
});

test('registration snapshots the original owner when a caller mutates its claim', async () => {
  const port = new FakeBrowserPort();
  const original = { ...binding };
  const gate = new BrowserHostCapability({ assert: async () => {} });
  const unregister = gate.register({ binding: original, port, consented: async () => true });
  original.tabID = 'mutated_tab';
  await assert.rejects(gate.claim(original), /owner mismatch/);
  await gate.claim(binding);
  await gate.release(binding);
  unregister();
});

test('host consent and both OpenCode permission actions are required before claim', async () => {
  const revoked = fixture();
  revoked.revoke();
  await assert.rejects(revoked.gate.claim(binding), /consent absent/);
  assert.deepEqual(revoked.calls, []);
  revoked.unregister();

  for (const action of ['browser', 'webbridge_browser']) {
    const denied = fixture(action);
    await assert.rejects(denied.gate.claim(binding), /denied/);
    assert.deepEqual(denied.calls, action === 'browser'
      ? ['browser:*'] : ['browser:*', 'webbridge_browser:qwen:tab_one']);
    await assert.rejects(denied.port.submit(binding, { turnID: 'turn_one', prompt: 'a' }), /not owned/);
    denied.unregister();
  }
});

test('host registration cannot change while bound; revocation blocks data, still permits cleanup', async () => {
  const host = fixture();
  await host.gate.claim(binding);
  assert.deepEqual(host.calls, ['browser:*', 'webbridge_browser:qwen:tab_one']);
  assert.throws(() => host.gate.register({ binding, port: new FakeBrowserPort(), consented: async () => true }), /already registered/);
  assert.throws(host.unregister, /release browser binding/);
  await host.gate.submit(binding, { turnID: 'turn_one', prompt: 'hello' });
  assert.deepEqual(await host.gate.events(binding, 'turn_one', 0), [
    { seq: 1, kind: 'text', turnID: 'turn_one', value: 'fixture:hello' },
    { seq: 2, kind: 'finished', turnID: 'turn_one' },
  ]);
  // Submit and result each recheck both native permission actions after await.
  assert.equal(host.calls.length, 10);
  host.revoke();
  await assert.rejects(host.gate.events(binding, 'turn_one', 0), /consent absent/);
  await assert.rejects(host.gate.submit(binding, { turnID: 'turn_two', prompt: 'no' }), /consent absent/);
  assert.equal(await host.gate.cancel(binding, 'turn_one'), false);
  await host.gate.release(binding);
  host.unregister();
  await assert.rejects(host.gate.claim(binding), /unavailable/);
});

test('revocation during permission prompt prevents claim without invoking driver', async () => {
  let notify!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { notify = resolve; });
  const approved = new Promise<void>((resolve) => { resume = resolve; });
  const permission = { assert: async (input: { action: string }) => {
    if (input.action === 'webbridge_browser') { notify(); await approved; }
  } } as unknown as Pick<Plugin.Context['permission'], 'assert'>;
  const gate = new BrowserHostCapability(permission);
  const port = new FakeBrowserPort();
  let consent = true;
  const unregister = gate.register({ binding, port, consented: async () => consent });
  const claiming = gate.claim(binding);
  await waiting;
  consent = false;
  resume();
  await assert.rejects(claiming, /consent absent/);
  await assert.rejects(port.submit(binding, { turnID: 'turn_one', prompt: 'blocked' }), /not owned/);
  unregister();
});

test('revoked consent during pending read never releases late private browser events', async () => {
  let entered!: () => void;
  let release!: (events: { seq: number; kind: 'text'; turnID: string; value: string }[]) => void;
  const running = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<{ seq: number; kind: 'text'; turnID: string; value: string }[]>((resolve) => { release = resolve; });
  const fixturePort = new FakeBrowserPort();
  let consent = true;
  const gate = new BrowserHostCapability({ assert: async () => {} });
  const registration = gate.register({ binding, consented: async () => consent, port: {
    claim: (id) => fixturePort.claim(id),
    submit: (id, input) => fixturePort.submit(id, input),
    events: async () => { entered(); return pending; },
    cancel: (id, turnID) => fixturePort.cancel(id, turnID),
    release: (id) => fixturePort.release(id),
  } });
  await gate.claim(binding);
  const reading = gate.events(binding, 'turn_one', 0);
  await running;
  consent = false;
  release([{ seq: 1, kind: 'text', turnID: 'turn_one', value: 'PRIVATE_PAGE_CONTENT' }]);
  await assert.rejects(reading, /consent absent|revoked/);
  await gate.release(binding);
  registration();
});

test('permission changed by policy/hook during awaited browser read refuses returned page data', async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let revoked = false;
  const gate = new BrowserHostCapability({ assert: async () => {
    if (revoked) throw new Error('revoked browser policy');
  } });
  const registration = gate.register({ binding, consented: async () => true, port: {
    claim: async () => {}, submit: async () => {},
    events: async () => { entered(); await pending; return [
      { seq: 1, kind: 'text' as const, turnID: 't1', value: 'PROTECTED_CONTENT' },
    ]; },
    cancel: async () => false, release: async () => {},
  } });
  await gate.claim(binding);
  const reading = gate.events(binding, 't1', 0);
  await waiting;
  revoked = true;
  release();
  await assert.rejects(reading, /revoked browser policy/);
  await gate.release(binding);
  registration();
});

test('revocation after a dispatched submit cannot falsely acknowledge success or permit blind replay', async () => {
  let sent!: () => void;
  let ack!: () => void;
  const invoked = new Promise<void>((resolve) => { sent = resolve; });
  const pending = new Promise<void>((resolve) => { ack = resolve; });
  let consent = true;
  let calls = 0;
  const gate = new BrowserHostCapability({ assert: async () => {} });
  const registration = gate.register({ binding, consented: async () => consent, port: {
    claim: async () => {},
    submit: async () => { calls++; sent(); await pending; },
    events: async () => [],
    cancel: async () => false,
    release: async () => {},
  } });
  await gate.claim(binding);
  const request = { turnID: 'turn_dispatched', prompt: 'untrusted page input' };
  const submitting = gate.submit(binding, request);
  await invoked;
  consent = false;
  ack();
  await assert.rejects(submitting, /uncertain|revoked/);
  consent = true;
  await assert.rejects(gate.submit(binding, request), /reconcile before retry|already/);
  assert.equal(calls, 1);
  await gate.release(binding);
  registration();
});

test('two concurrent submissions with one turn identity can dispatch only one effect', async () => {
  let entered!: () => void;
  let ack!: () => void;
  const sent = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { ack = resolve; });
  let submitted = 0;
  const gate = new BrowserHostCapability({ assert: async () => {} });
  const registration = gate.register({ binding, consented: async () => true, port: {
    claim: async () => {},
    submit: async () => { submitted++; entered(); await pending; },
    events: async () => [], cancel: async () => false, release: async () => {},
  } });
  await gate.claim(binding);
  const input = { turnID: 'same_turn', prompt: 'hello' };
  const first = gate.submit(binding, input);
  await sent;
  await assert.rejects(gate.submit(binding, input), /already dispatched/);
  ack();
  await first;
  assert.equal(submitted, 1);
  await gate.release(binding);
  registration();
});
