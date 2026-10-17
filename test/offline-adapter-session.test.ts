import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import { OfflineAdapterSession, type OfflineBinding } from '../src/testing/offline-adapter-session.js';

for (const provider of WEB_PROVIDER_CATALOG) {
  const owner: OfflineBinding = { providerID: provider.id, sessionID: 'session_one',
    accountRef: 'account_one', tabID: 'tab_one', connectionID: 'desktop_one', generation: 1 };

  test(`${provider.id}: manual login and bound streamed fixture turn never enable commercial model`, () => {
    const adapter = new OfflineAdapterSession(provider.id);
    assert.deepEqual(adapter.snapshot(), { providerID: provider.id, phase: 'disconnected',
      sessionID: undefined, accountRef: undefined, tabID: undefined,
      generation: undefined, turnID: undefined, seq: undefined });
    adapter.pair(owner);
    assert.equal(adapter.snapshot().phase, 'login-required');
    assert.throws(() => adapter.start(owner, 't1'), /not ready/);
    adapter.observe({ binding: owner, signedIn: true });
    assert.equal(adapter.snapshot().phase, 'fixture-ready');
    adapter.start(owner, 't1');
    adapter.progress(owner, { turnID: 't1', seq: 1, text: 'first ' });
    adapter.progress(owner, { turnID: 't1', seq: 2, text: 'second' });
    assert.equal(adapter.finish(owner, 't1', 'first second'), 'first second');
    assert.equal(adapter.snapshot().phase, 'finished');
    assert.equal(JSON.stringify(adapter.snapshot()).includes('first'), false);
    adapter.observe({ binding: owner, signedIn: false });
    assert.equal(adapter.snapshot().phase, 'login-required');
    adapter.observe({ binding: owner, signedIn: true });
    assert.throws(() => adapter.start(owner, 't1'), /already spent/);
    const next = { ...owner, generation: 2, connectionID: 'desktop_two' };
    adapter.reconnect(owner, next);
    assert.equal(adapter.snapshot().phase, 'login-required');
    assert.throws(() => adapter.progress(owner, { turnID: 't1', seq: 3, text: 'late' }), /owner/);
    adapter.observe({ binding: next, signedIn: true });
    adapter.start(next, 't2');
    adapter.progress(next, { turnID: 't2', seq: 1, text: 'rebound' });
    assert.equal(adapter.finish(next, 't2', 'rebound'), 'rebound');
  });

  test(`${provider.id}: identity and credential confusion rejected before any fragment`, () => {
    const adapter = new OfflineAdapterSession(provider.id);
    assert.throws(() => adapter.pair({ ...owner, cookie: 'secret' } as OfflineBinding), /credential-like|plain data record/);
    adapter.pair(owner);
    assert.throws(() => adapter.observe({ binding: { ...owner, accountRef: 'other' }, signedIn: true }), /owner/);
    assert.throws(() => adapter.observe({ binding: owner, signedIn: 'true' } as never), /manual observation/);
    adapter.observe({ binding: owner, signedIn: true });
    adapter.start(owner, 't1');
    for (const wrong of [{ ...owner, sessionID: 'other' }, { ...owner, accountRef: 'other' },
      { ...owner, tabID: 'other' }, { ...owner, connectionID: 'other' }, { ...owner, generation: 2 }]) {
      assert.throws(() => adapter.progress(wrong, { turnID: 't1', seq: 1, text: 'secret' }), /owner/);
    }
    assert.throws(() => adapter.progress(owner, { turnID: 'other', seq: 1, text: 'wrong' }), /identity/);
    assert.throws(() => adapter.progress(owner, { turnID: 't1', seq: 2, text: 'skip' }), /order/);
    assert.throws(() => adapter.progress(owner, { turnID: 't1', seq: 1, text: 'x'.repeat(4097) }), /bounds/);
    adapter.progress(owner, { turnID: 't1', seq: 1, text: 'ok' });
    assert.throws(() => adapter.progress(owner, { turnID: 't1', seq: 1, text: 'again' }), /order/);
    assert.throws(() => adapter.finish(owner, 't1', 'rewritten'), /terminal mismatch/);
  });

  test(`${provider.id}: interruption/reconnect require operator reconciliation, no blind replay`, () => {
    const adapter = new OfflineAdapterSession(provider.id);
    adapter.pair(owner);
    adapter.observe({ binding: owner, signedIn: true });
    adapter.start(owner, 't1');
    adapter.progress(owner, { turnID: 't1', seq: 1, text: 'incomplete' });
    adapter.interrupt(owner);
    assert.equal(adapter.snapshot().phase, 'uncertain');
    assert.throws(() => adapter.finish(owner, 't1', 'incomplete'), /terminal mismatch/);
    assert.throws(() => adapter.start(owner, 't1'), /not ready/);
    assert.throws(() => adapter.observe({ binding: owner, signedIn: true }), /reconciliation/);
    assert.throws(() => adapter.reconnect(owner, { ...owner, connectionID: 'new', generation: 2 }), /reconcile/);
    assert.throws(() => adapter.reconcile(owner, { turnID: 't1', outcome: 'observed-applied', hash: 'not-proof' }), /evidence/);
    adapter.reconcile(owner, { turnID: 't1', outcome: 'observed-not-applied', hash: 'f'.repeat(64) });
    assert.equal(adapter.snapshot().phase, 'login-required');
    adapter.observe({ binding: owner, signedIn: true });
    assert.throws(() => adapter.start(owner, 't1'), /already spent/);
    adapter.start(owner, 't2');
  });

  test(`${provider.id}: untrusted lifecycle records cannot execute accessors or smuggle metadata`, () => {
    const adapter = new OfflineAdapterSession(provider.id);
    let observed = 0;
    const accessor = (base: Record<string, unknown>, field: string) => {
      const result = { ...base };
      Object.defineProperty(result, field, { enumerable: true, get() { observed++; return base[field]; } });
      return result;
    };
    assert.throws(() => adapter.pair(accessor(owner, 'accountRef') as OfflineBinding), /plain|data|record/);
    assert.equal(observed, 0);
    adapter.pair(owner);
    assert.throws(() => adapter.observe(accessor({ binding: owner, signedIn: true }, 'signedIn') as never), /plain|data|record/);
    assert.equal(observed, 0);
    adapter.observe({ binding: owner, signedIn: true });
    adapter.start(owner, 't1');
    assert.throws(() => adapter.progress(owner, accessor({ turnID: 't1', seq: 1, text: 'fake' }, 'text') as never), /plain|data|record/);
    assert.equal(observed, 0);
    adapter.progress(owner, { turnID: 't1', seq: 1, text: 'first' });
    adapter.interrupt(owner);
    assert.throws(() => adapter.reconcile(owner, accessor({ turnID: 't1', outcome: 'observed-not-applied', hash: 'f'.repeat(64) }, 'hash') as never), /plain|data|record/);
    assert.equal(observed, 0);
    assert.throws(() => adapter.reconcile(owner, { turnID: 't1', outcome: 'observed-not-applied', hash: 'f'.repeat(64), cookie: 'NEVER_ACCEPT' } as never), /plain|data|record/);
    assert.equal(adapter.snapshot().phase, 'uncertain');
  });
}
