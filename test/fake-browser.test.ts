import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FakeBrowserPort } from '../src/testing/fake-browser.js';
import type { TabClaim } from '../src/core/browser-port.js';

const binding: TabClaim = { sessionID: 'sess-1', tabID: 'tab-1', providerID: 'qwen', accountRef: 'acct-1' };

test('fixture browser isolates sessions and refuses account/provider spoofing', async () => {
  const browser = new FakeBrowserPort();
  await browser.claim(binding);
  await assert.rejects(browser.claim({ ...binding, sessionID: 'sess-2' }), /already claimed/);
  await assert.rejects(browser.claim({ ...binding, tabID: 'tab-2' }), /already claimed/);
  for (const forged of [
    { ...binding, accountRef: 'acct-2' },
    { ...binding, providerID: 'gemini' as const },
    { ...binding, sessionID: 'sess-2' },
  ]) {
    await assert.rejects(browser.submit(forged, { turnID: 'turn-1', prompt: 'hello' }), /not owned/);
    await assert.rejects(browser.release(forged), /not owned/);
  }
  await browser.release(binding);
  await assert.rejects(browser.events(binding, 'turn-1', 0), /not owned/);
});

test('fixture captures only ordered cursor-addressable events and refuses duplicate turn sends', async () => {
  const browser = new FakeBrowserPort();
  await browser.claim(binding);
  await browser.submit(binding, { turnID: 'turn-1', prompt: 'hello' });
  assert.deepEqual(await browser.events(binding, 'turn-1', 0), [
    { kind: 'text', seq: 1, turnID: 'turn-1', value: 'fixture:hello' },
    { kind: 'finished', seq: 2, turnID: 'turn-1' },
  ]);
  assert.deepEqual(await browser.events(binding, 'turn-1', 1), [{ kind: 'finished', seq: 2, turnID: 'turn-1' }]);
  assert.deepEqual(await browser.events(binding, 'turn-1', 2), []);
  await assert.rejects(browser.submit(binding, { turnID: 'turn-1', prompt: 'hello' }), /reconcile before retry/);
  assert.equal(await browser.cancel(binding, 'turn-1'), false);
  await browser.release(binding);
});

test('fixture rejects invalid IDs, invalid cursors and giant prompts', async () => {
  const browser = new FakeBrowserPort();
  await assert.rejects(browser.claim({ ...binding, tabID: '../cookies' }), /invalid opaque/);
  await browser.claim(binding);
  await assert.rejects(browser.submit(binding, { turnID: 'x', prompt: 'a'.repeat(16_001) }), /length out of bounds/);
  await browser.submit(binding, { turnID: 'turn-1', prompt: 'ok' });
  await assert.rejects(browser.events(binding, 'turn-1', -1), /sequence cursor/);
  await assert.rejects(browser.events(binding, 'turn-unknown', 0), /unknown turn/);
});
