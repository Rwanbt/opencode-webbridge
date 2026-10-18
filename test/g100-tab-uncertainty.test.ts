import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('G100 uncertain native page turn refuses progress, duplicate terminal, replay, new submit', async () => {
  const keys = ['WEBBRIDGE_G81_TEST_ONLY', 'WEBBRIDGE_FIXTURE_ENABLE',
    'WEBBRIDGE_G81_SECRET', 'WEBBRIDGE_FIXTURE_TOKEN', 'WEBBRIDGE_FIXTURE_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const handlers = new Map<string, Record<string, (input: any) => Promise<any>>>();
  let disposed = 0;
  const secret = 'd'.repeat(64);
  const turnID = 'a'.repeat(32);
  try {
    Object.assign(process.env, {
      WEBBRIDGE_G81_TEST_ONLY: '1', WEBBRIDGE_FIXTURE_ENABLE: '1',
      WEBBRIDGE_G81_SECRET: secret, WEBBRIDGE_FIXTURE_TOKEN: 'e'.repeat(64),
      WEBBRIDGE_FIXTURE_URL: 'http://127.0.0.1:26319/v1',
    });
    const plugin = (await import(pathToFileURL(resolve(
      process.env.G100_BASELINE_PLUGIN || 'fixtures/g97-combined-preview.mjs')).href)).default;
    const cleanup = await plugin.setup({
      rpc: { register: async (contract: { id: string }, methods: Record<string, (input: any) => Promise<any>>) => {
        handlers.set(contract.id, methods);
        return { dispose: () => { disposed++; } };
      } },
      provider: { transform: async (edit: (arg: { add: (value: unknown) => void }) => void) => {
        edit({ add: () => {} });
        return { dispose: () => { disposed++; } };
      } },
    });
    const page = handlers.get('webbridge-g99-page')!;
    const claim = { secret, scope: 'g99-local-page', turnID };
    await page.submit({ ...claim, prompt: 'G99_LOCAL_PAGE_QUESTION: local test only' });
    assert.equal((await page.take(claim)).found, true);
    await page.progress({ ...claim, seq: 1, value: 'WEBBRIDGE_LOCAL_PAGE_OK:' });
    await assert.rejects(page.uncertain({ ...claim, secret: '0'.repeat(64), reason: 'tab-changed' }), /denied/);
    await assert.rejects(page.uncertain({ ...claim, reason: 'disconnect' }), /denied/);
    assert.deepEqual(await page.uncertain({ ...claim, reason: 'tab-changed' }), { accepted: true });
    for (const attempt of [
      page.progress({ ...claim, seq: 2, value: 'forged-continuation' }),
      page.complete({ ...claim, response: 'WEBBRIDGE_LOCAL_PAGE_OK:forged' }),
      page.uncertain({ ...claim, reason: 'tab-changed' }),
      page.submit({ ...claim, turnID: 'b'.repeat(32), prompt: 'G99_LOCAL_PAGE_QUESTION: retry' }),
    ]) await assert.rejects(attempt, /denied|duplicate/);
    assert.equal((await page.take(claim)).found, false);
    const events = (await page.poll({ ...claim, afterSeq: 0 })).events;
    assert.deepEqual(events.map((event: { kind: string; seq: number }) =>
      [event.kind, event.seq]), [['text', 1], ['cancelled', 2]]);
    assert.equal(events.some((event: { kind: string }) => event.kind === 'finished'), false);
    await cleanup?.();
    assert.equal(disposed, 3);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
