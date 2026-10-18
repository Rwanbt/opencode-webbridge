import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('G112 browser disconnect after one DOM delta is terminal and cannot be replayed', async () => {
  const keys = ['WEBBRIDGE_G81_TEST_ONLY', 'WEBBRIDGE_FIXTURE_ENABLE', 'WEBBRIDGE_G81_SECRET',
    'WEBBRIDGE_FIXTURE_TOKEN', 'WEBBRIDGE_FIXTURE_URL'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const secret = 'b'.repeat(64), turnID = 'c'.repeat(32);
  const handlers = new Map<string, Record<string, (input: any) => Promise<any>>>();
  try {
    Object.assign(process.env, { WEBBRIDGE_G81_TEST_ONLY: '1', WEBBRIDGE_FIXTURE_ENABLE: '1',
      WEBBRIDGE_G81_SECRET: secret, WEBBRIDGE_FIXTURE_TOKEN: 'a'.repeat(64),
      WEBBRIDGE_FIXTURE_URL: 'http://127.0.0.1:26319/v1' });
    const plugin = (await import(pathToFileURL(resolve('fixtures/g97-combined-preview.mjs')).href)).default;
    const dispose = await plugin.setup({
      rpc: { register: async (contract: { id: string }, methods: Record<string, (input: any) => Promise<any>>) => {
        handlers.set(contract.id, methods); return { dispose() {} };
      } },
      provider: { transform: async (edit: (value: {add: (model: unknown) => void}) => void) => {
        edit({ add() {} }); return { dispose() {} };
      } },
    });
    const page = handlers.get('webbridge-g99-page')!;
    const auth = { secret, scope: 'g99-local-page', turnID };
    await page.submit({ ...auth, prompt: 'G99_LOCAL_PAGE_QUESTION: disconnect' });
    assert.equal((await page.take(auth)).found, true);
    await page.progress({ ...auth, seq: 1, value: 'WEBBRIDGE_LOCAL_PAGE_OK:' });
    assert.deepEqual(await page.uncertain({ ...auth, reason: 'browser-disconnected' }), { accepted: true });
    assert.deepEqual((await page.poll({ ...auth, afterSeq: 0 })).events.map((e: { kind: string }) => e.kind),
      ['text', 'cancelled']);
    for (const pending of [
      page.progress({ ...auth, seq: 2, value: 'late' }),
      page.complete({ ...auth, response: 'WEBBRIDGE_LOCAL_PAGE_OK:late' }),
      page.uncertain({ ...auth, reason: 'browser-disconnected' }),
      page.submit({ ...auth, turnID: 'd'.repeat(32), prompt: 'G99_LOCAL_PAGE_QUESTION: retry' }),
    ]) await assert.rejects(pending, /denied|duplicate/);
    assert.equal((await page.take(auth)).found, false);
    await dispose?.();
  } finally {
    for (const k of keys) if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k];
  }
});
