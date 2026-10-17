import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('G99 installed plugin one-turn page RPC denies forged scope, replay, cursor and invalid completion', async () => {
  const { default: plugin } = await import(pathToFileURL(resolve('fixtures/g97-combined-preview.mjs')).href);
  const keys = ['WEBBRIDGE_G81_TEST_ONLY', 'WEBBRIDGE_FIXTURE_ENABLE',
    'WEBBRIDGE_G81_SECRET', 'WEBBRIDGE_FIXTURE_TOKEN', 'WEBBRIDGE_FIXTURE_URL'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const secret = 'a'.repeat(64);
  const registered = new Map<string, Record<string, (input: any) => Promise<any>>>();
  let disposed = 0;
  try {
    Object.assign(process.env, {
      WEBBRIDGE_G81_TEST_ONLY: '1', WEBBRIDGE_FIXTURE_ENABLE: '1',
      WEBBRIDGE_G81_SECRET: secret, WEBBRIDGE_FIXTURE_TOKEN: 'b'.repeat(64),
      WEBBRIDGE_FIXTURE_URL: 'http://127.0.0.1:13337/v1',
    });
    const ctx = {
      rpc: { register: async (contract: { id: string; methods: Record<string, unknown> },
        handlers: Record<string, (input: any) => Promise<any>>) => {
        registered.set(contract.id, handlers);
        assert.deepEqual(Object.keys(contract.methods),
          contract.id === 'webbridge-g99-page'
            ? ['submit', 'take', 'progress', 'complete', 'poll'] : ['challenge']);
        return { dispose: () => { disposed++; } };
      } },
      provider: { transform: async (edit: (editor: { add(value: unknown): void }) => void) => {
        edit({ add: () => {} });
        return { dispose: () => { disposed++; } };
      } },
    };
    const cleanup = await plugin.setup(ctx);
    const page = registered.get('webbridge-g99-page')!;
    const turnID = 'f'.repeat(32);
    const authorized = { secret, scope: 'g99-local-page', turnID };
    await assert.rejects(page.submit({ ...authorized, scope: 'external',
      prompt: 'G99_LOCAL_PAGE_QUESTION: test' }), /denied/);
    await assert.rejects(page.submit({ ...authorized, secret: '0'.repeat(64),
      prompt: 'G99_LOCAL_PAGE_QUESTION: test' }), /denied/);
    await assert.rejects(page.submit({ ...authorized, prompt: 'https://commercial.example/' }), /denied/);
    assert.deepEqual(await page.submit({ ...authorized, prompt: 'G99_LOCAL_PAGE_QUESTION: test' }),
      { accepted: true });
    await assert.rejects(page.submit({ ...authorized, prompt: 'G99_LOCAL_PAGE_QUESTION: test' }), /duplicate/);
    assert.equal((await page.take(authorized)).found, true);
    assert.equal((await page.take(authorized)).found, false);
    await assert.rejects(page.progress({ ...authorized, seq: 2, value: 'second' }), /denied/);
    await assert.rejects(page.complete({ ...authorized, response: 'early' }), /denied/);
    const fragments = ['WEBBRIDGE_LOCAL_PAGE_OK:', 'G99_LOCAL_PAGE_', 'QUESTION: test'];
    for (let i = 0; i < fragments.length; i++) {
      assert.deepEqual(await page.progress({ ...authorized, seq: i + 1, value: fragments[i] }),
        { accepted: true });
    }
    await assert.rejects(page.progress({ ...authorized, seq: 3, value: 'duplicate' }), /denied/);
    assert.equal((await page.poll({ ...authorized, afterSeq: 0 })).events.length, 3);
    await assert.rejects(page.poll({ ...authorized, afterSeq: -1 }), /denied/);
    await assert.rejects(page.complete({ ...authorized, response: 'forged' }), /denied/);
    assert.deepEqual(await page.complete({ ...authorized, response: fragments.join('') }),
      { accepted: true });
    await assert.rejects(page.complete({ ...authorized, response: fragments.join('') }), /denied/);
    const terminal = (await page.poll({ ...authorized, afterSeq: 3 })).events;
    assert.deepEqual(terminal, [{ seq: 4, turnID, kind: 'finished' }]);
    await cleanup?.();
    assert.equal(disposed, 3);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
