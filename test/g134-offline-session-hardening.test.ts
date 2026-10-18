// G134 — adversarial RED→GREEN matrix over OfflineAdapterSession inputs.
// Fixture-only state machine: no DOM, no cookies, no network, no provider access.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../src/catalog.js';
import { OfflineAdapterSession, type OfflineBinding } from '../src/testing/offline-adapter-session.js';

const TURN_ID = 'turn_1';
type AnyRecord = Record<string, unknown>;

function bindingFor(providerID: WebProviderID, overrides: Partial<OfflineBinding> = {}): OfflineBinding {
  return {
    providerID, sessionID: 'session_one', accountRef: 'account_one',
    tabID: 'tab_one', connectionID: 'desktop_one', generation: 1, ...overrides,
  };
}

function ready(providerID: WebProviderID): { session: OfflineAdapterSession; owner: OfflineBinding } {
  const owner = bindingFor(providerID);
  const session = new OfflineAdapterSession(providerID);
  session.pair(owner);
  session.observe({ binding: owner, signedIn: true });
  return { session, owner };
}

function streaming(providerID: WebProviderID): { session: OfflineAdapterSession; owner: OfflineBinding } {
  const { session, owner } = ready(providerID);
  session.start(owner, TURN_ID);
  session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'partial ' });
  return { session, owner };
}

for (const provider of WEB_PROVIDER_CATALOG) {
  const pid = provider.id;

  test(`g134 ${pid}: hostile binding objects are refused before any getter or trap runs`, () => {
    const owner = bindingFor(pid);
    const session = new OfflineAdapterSession(pid);

    let getterCalls = 0;
    const accessor = { ...owner } as AnyRecord;
    delete accessor.accountRef;
    Object.defineProperty(accessor, 'accountRef', {
      enumerable: true,
      get() { getterCalls += 1; return 'account_one'; },
    });
    assert.throws(() => session.pair(accessor as unknown as OfflineBinding), /accessor-rejected:accountRef/);
    assert.equal(getterCalls, 0);
    assert.equal(session.snapshot().phase, 'disconnected');

    let trapCalls = 0;
    const proxy = new Proxy({ ...owner }, {
      get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
      getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
      ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
    });
    assert.throws(() => session.pair(proxy), /proxy-rejected/);
    assert.equal(trapCalls, 0);
    assert.equal(session.snapshot().phase, 'disconnected');

    class Bound implements OfflineBinding {
      providerID = pid as WebProviderID;
      sessionID = 'session_one'; accountRef = 'account_one';
      tabID = 'tab_one'; connectionID = 'desktop_one'; generation = 1;
    }
    assert.throws(() => session.pair(new Bound()), /unexpected-prototype/);

    const hidden = { ...owner } as AnyRecord;
    Object.defineProperty(hidden, 'cookie', { value: 'secret', enumerable: false });
    assert.throws(() => session.pair(hidden as unknown as OfflineBinding), /unexpected-field:cookie/);

    const withSymbol = { ...owner } as AnyRecord;
    (withSymbol as never as Record<symbol, string>)[Symbol('token')] = 'secret';
    assert.throws(() => session.pair(withSymbol as unknown as OfflineBinding), /symbol-key-rejected/);

    let toJSONCalls = 0;
    const withToJSON = { ...owner, toJSON() { toJSONCalls += 1; return {}; } };
    assert.throws(() => session.pair(withToJSON as OfflineBinding), /tojson-rejected/);
    assert.equal(toJSONCalls, 0);

    for (const field of ['cookie', 'token', 'password', 'authorization']) {
      const injected = { ...owner, [field]: 'secret-value' };
      assert.throws(() => session.pair(injected as unknown as OfflineBinding), new RegExp(`unexpected-field:${field}`));
    }
    assert.equal(session.snapshot().phase, 'disconnected');
  });

  test(`g134 ${pid}: account, session, tab, connection and provider isolation`, () => {
    const owner = bindingFor(pid);
    const session = new OfflineAdapterSession(pid);
    session.pair(owner);
    session.observe({ binding: owner, signedIn: true });

    const collisions = [
      { ...owner, accountRef: 'account_other' },
      { ...owner, sessionID: 'session_other' },
      { ...owner, tabID: 'tab_other' },
      { ...owner, connectionID: 'desktop_other' },
      { ...owner, generation: 2 },
    ];
    for (const collision of collisions) {
      assert.throws(() => session.observe({ binding: collision, signedIn: true }), /owner/);
      assert.throws(() => session.start(collision, 'turn_x'), /owner/);
    }
    session.start(owner, TURN_ID);
    for (const collision of collisions) {
      assert.throws(() => session.progress(collision, { turnID: TURN_ID, seq: 1, text: 'x' }), /owner/);
      assert.throws(() => session.finish(collision, TURN_ID, ''), /owner/);
      assert.throws(() => session.interrupt(collision), /owner/);
      assert.throws(() => session.reconnect(collision, { ...owner, generation: 2, connectionID: 'desktop_two' }), /owner/);
      assert.throws(() => session.reconcile(collision, { turnID: TURN_ID, outcome: 'observed-not-applied', hash: 'a'.repeat(64) }), /owner/);
    }

    const otherProvider = WEB_PROVIDER_CATALOG.find((entry) => entry.id !== pid);
    assert.ok(otherProvider);
    const foreign = bindingFor(otherProvider.id);
    assert.throws(() => new OfflineAdapterSession(pid).pair(foreign), /provider mismatch/);
    assert.throws(() => session.observe({ binding: foreign, signedIn: true }), /provider mismatch/);
  });

  test(`g134 ${pid}: generation only advances across reconnect; stale bindings are inert`, () => {
    const { session, owner } = ready(pid);
    const next = { ...owner, connectionID: 'desktop_two', generation: 2 };

    assert.throws(() => session.reconnect(owner, { ...owner, connectionID: 'desktop_two' }), /generation mismatch/);
    assert.throws(() => session.reconnect(owner, { ...next, generation: 1 }), /generation mismatch/);
    assert.throws(() => session.reconnect(owner, { ...next, connectionID: owner.connectionID }), /generation mismatch/);
    assert.throws(() => session.reconnect(owner, { ...next, accountRef: 'account_other' }), /generation mismatch/);

    session.reconnect(owner, next);
    assert.equal(session.snapshot().phase, 'login-required');
    assert.equal(session.snapshot().generation, 2);

    assert.throws(() => session.observe({ binding: owner, signedIn: true }), /owner/);
    assert.throws(() => session.start(owner, 'turn_stale'), /owner/);
    assert.throws(() => session.reconnect(owner, { ...next, generation: 3, connectionID: 'desktop_three' }), /owner/);
    assert.throws(() => session.reconnect(next, { ...next, generation: 1, connectionID: 'desktop_three' }), /generation mismatch/);

    session.observe({ binding: next, signedIn: true });
    session.start(next, 'turn_ok');
    assert.throws(() => session.progress(next, { turnID: 'turn_ok', seq: 2, text: 'skip' }), /order/);
    session.progress(next, { turnID: 'turn_ok', seq: 1, text: 'ok' });
    assert.equal(session.finish(next, 'turn_ok', 'ok'), 'ok');
    assert.throws(() => session.start(next, 'turn_ok'), /not ready/); // finished phase still refuses
    session.observe({ binding: next, signedIn: true });
    assert.throws(() => session.start(next, 'turn_ok'), /already spent/); // consumed turns stay consumed
  });

  test(`g134 ${pid}: manual revocation forces re-observation on a fresh connection`, () => {
    const { session, owner } = ready(pid);
    session.start(owner, TURN_ID);
    session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'done' });
    session.finish(owner, TURN_ID, 'done');

    session.observe({ binding: owner, signedIn: false }); // manual revocation observation
    assert.equal(session.snapshot().phase, 'login-required');
    assert.throws(() => session.start(owner, 'turn_after_revoke'), /not ready/);
    assert.throws(() => session.reconnect(owner, { ...owner, generation: 2 }), /generation mismatch/);

    const next = { ...owner, connectionID: 'desktop_two', generation: 2 };
    session.reconnect(owner, next);
    assert.throws(() => session.start(owner, 'turn_after_revoke'), /owner/);
    assert.throws(() => session.start(next, 'turn_after_revoke'), /not ready/); // re-observation is mandatory

    session.observe({ binding: next, signedIn: true });
    session.start(next, 'turn_after_revoke');
    session.progress(next, { turnID: 'turn_after_revoke', seq: 1, text: 'go' });
    assert.equal(session.finish(next, 'turn_after_revoke', 'go'), 'go');
  });

  test(`g134 ${pid}: fragments stay ordered, bounded and terminal-consistent`, () => {
    const { session, owner } = ready(pid);
    session.start(owner, TURN_ID);

    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 0, text: 'x' }), /order/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 1.5, text: 'x' } as never), /order/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: '1', text: 'x' } as never), /order/);
    assert.throws(() => session.progress(owner, { turnID: 'other', seq: 1, text: 'x' }), /identity/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 1, text: '' }), /bounds/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'x'.repeat(4097) }), /bounds/);

    session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'a'.repeat(4096) });
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'dup' }), /order/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 3, text: 'skip' }), /order/);
    session.progress(owner, { turnID: TURN_ID, seq: 2, text: 'b'.repeat(4096) });
    session.progress(owner, { turnID: TURN_ID, seq: 3, text: 'c'.repeat(4096) });
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 4, text: 'd'.repeat(4096) }), /bounds/);

    const fresh = ready(pid);
    fresh.session.start(fresh.owner, 'turn_empty');
    assert.throws(() => fresh.session.finish(fresh.owner, 'turn_empty', ''), /terminal mismatch/);

    const total = 'a'.repeat(4096) + 'b'.repeat(4096) + 'c'.repeat(4096);
    assert.throws(() => session.finish(owner, TURN_ID, 'wrong'), /terminal mismatch/);
    assert.equal(session.finish(owner, TURN_ID, total), total);
    assert.throws(() => session.finish(owner, TURN_ID, total), /terminal mismatch/); // single terminal
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 4, text: 'late' }), /not streaming/);
  });

  test(`g134 ${pid}: streaming failure goes uncertain — no false success, no auto replay`, () => {
    const { session, owner } = streaming(pid);
    session.interrupt(owner);
    assert.equal(session.snapshot().phase, 'uncertain');

    assert.throws(() => session.finish(owner, TURN_ID, 'partial '), /terminal mismatch/);
    assert.equal(session.snapshot().phase, 'uncertain', 'failed terminal must not convert uncertain to success');
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 2, text: 'late' }), /not streaming/);
    assert.equal(session.snapshot().phase, 'uncertain');
    assert.throws(() => session.start(owner, TURN_ID), /not ready/);
    assert.throws(() => session.observe({ binding: owner, signedIn: true }), /reconciliation/);
    assert.throws(() => session.reconnect(owner, { ...owner, connectionID: 'desktop_two', generation: 2 }), /reconcile/);
    assert.equal(session.snapshot().phase, 'uncertain');

    assert.throws(() => session.reconcile(owner, { turnID: 'other', outcome: 'observed-not-applied', hash: 'f'.repeat(64) }), /evidence/);
    assert.throws(() => session.reconcile(owner, { turnID: TURN_ID, outcome: 'observed-not-applied', hash: 'nope' }), /evidence/);
    assert.equal(session.snapshot().phase, 'uncertain');
    session.reconcile(owner, { turnID: TURN_ID, outcome: 'observed-not-applied', hash: 'f'.repeat(64) });
    assert.equal(session.snapshot().phase, 'login-required');

    session.observe({ binding: owner, signedIn: true });
    assert.throws(() => session.start(owner, TURN_ID), /already spent/);
    session.start(owner, 'turn_2');
    session.progress(owner, { turnID: 'turn_2', seq: 1, text: 'fresh' });
    assert.equal(session.finish(owner, 'turn_2', 'fresh'), 'fresh');
  });

  test(`g134 ${pid}: observation, event and evidence reject getters, proxies and extra fields`, () => {
    const { session, owner } = ready(pid);
    session.start(owner, TURN_ID);
    session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'x' });

    let observationGetter = 0;
    const observation = { binding: owner } as AnyRecord;
    Object.defineProperty(observation, 'signedIn', {
      enumerable: true,
      get() { observationGetter += 1; return true; },
    });
    assert.throws(() => session.observe(observation as never), /accessor-rejected:signedIn/);
    assert.equal(observationGetter, 0);

    let eventGetter = 0;
    const event = { turnID: TURN_ID, seq: 2 } as AnyRecord;
    Object.defineProperty(event, 'text', {
      enumerable: true,
      get() { eventGetter += 1; return 'late'; },
    });
    assert.throws(() => session.progress(owner, event as never), /accessor-rejected:text/);
    assert.equal(eventGetter, 0);

    let trapCalls = 0;
    const proxyEvent = new Proxy({ turnID: TURN_ID, seq: 2, text: 'x' }, {
      get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
      getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
      ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
    });
    assert.throws(() => session.progress(owner, proxyEvent as never), /proxy-rejected/);
    assert.equal(trapCalls, 0);

    assert.throws(() => session.observe({ binding: owner, signedIn: true, permissions: ['*'] } as never), /unexpected-field:permissions/);
    assert.throws(() => session.progress(owner, { turnID: TURN_ID, seq: 2, text: 'x', permissions: ['*'] } as never), /unexpected-field:permissions/);

    session.interrupt(owner);
    let evidenceGetter = 0;
    const evidence = { turnID: TURN_ID, outcome: 'observed-not-applied' } as AnyRecord;
    Object.defineProperty(evidence, 'hash', {
      enumerable: true,
      get() { evidenceGetter += 1; return 'f'.repeat(64); },
    });
    assert.throws(() => session.reconcile(owner, evidence as never), /accessor-rejected:hash/);
    assert.equal(evidenceGetter, 0);
    assert.throws(() => session.reconcile(owner, {
      turnID: TURN_ID, outcome: 'observed-not-applied', hash: 'f'.repeat(64), permissions: ['*'],
    } as never), /unexpected-field:permissions/);
  });
}

test('g134: fixture snapshots expose no model text, secret or operational field', () => {
  for (const provider of WEB_PROVIDER_CATALOG) {
    const { session, owner } = ready(provider.id);
    session.start(owner, TURN_ID);
    session.progress(owner, { turnID: TURN_ID, seq: 1, text: 'fixture-only-text' });
    session.finish(owner, TURN_ID, 'fixture-only-text');
    const snapshot = JSON.stringify(session.snapshot());
    assert.equal(snapshot.includes('fixture-only-text'), false);
    assert.equal(snapshot.includes('cookie'), false);
    assert.equal(snapshot.includes('token'), false);
    assert.equal(snapshot.includes('password'), false);
    assert.equal(snapshot.includes('operational'), false);
  }
});
