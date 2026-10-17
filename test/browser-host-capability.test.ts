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
  assert.equal(host.calls.length, 6);
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
