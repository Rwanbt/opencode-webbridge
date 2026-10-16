import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import fixturePlugin from '../src/testing/native-fixture-plugin.js';

test('test-only provider plugin cannot activate without explicit environment opt-in', async () => {
  const previous = process.env.WEBBRIDGE_FIXTURE_ENABLE;
  const previousURL = process.env.WEBBRIDGE_FIXTURE_URL;
  delete process.env.WEBBRIDGE_FIXTURE_ENABLE;
  process.env.WEBBRIDGE_FIXTURE_URL = 'http://127.0.0.1:12345/v1';
  const ctx = new Proxy({}, { get: () => { throw new Error('should be inert'); } });
  try {
    assert.equal(await fixturePlugin.setup(ctx as Parameters<typeof fixturePlugin.setup>[0]), undefined);
  } finally {
    if (previous === undefined) delete process.env.WEBBRIDGE_FIXTURE_ENABLE;
    else process.env.WEBBRIDGE_FIXTURE_ENABLE = previous;
    if (previousURL === undefined) delete process.env.WEBBRIDGE_FIXTURE_URL;
    else process.env.WEBBRIDGE_FIXTURE_URL = previousURL;
  }
});

test('opt-in fixture registers only a deterministic loopback native provider and disposes it', async () => {
  const previous = process.env.WEBBRIDGE_FIXTURE_ENABLE;
  const previousURL = process.env.WEBBRIDGE_FIXTURE_URL;
  process.env.WEBBRIDGE_FIXTURE_ENABLE = '1';
  process.env.WEBBRIDGE_FIXTURE_URL = 'http://127.0.0.1:41414/v1';
  let disposed = false;
  const registered: Array<{ info: { name: string; package?: string; settings?: Record<string, unknown> }; models: readonly { id: string }[] }> = [];
  const fake = {
    provider: {
      async transform(callback: (editor: { add: (item: typeof registered[number]) => void }) => void) {
        callback({ add: (item) => { registered.push(item); } });
        return { dispose: async () => { disposed = true; } };
      },
    },
  };
  try {
    const cleanup = await fixturePlugin.setup(fake as unknown as Parameters<typeof fixturePlugin.setup>[0]);
    assert.equal(registered.length, 1);
    assert.equal(registered[0].info.name, 'WebBridge Local Test Fixture');
    assert.equal(registered[0].info.package, '@opencode/ai/providers/openai-compatible');
    assert.equal(registered[0].info.settings?.baseURL, 'http://127.0.0.1:41414/v1');
    assert.equal(registered[0].models[0].id, 'webbridge-native-fixture');
    assert.equal(typeof cleanup, 'function');
    if (typeof cleanup === 'function') await cleanup();
    assert.equal(disposed, true);
  } finally {
    if (previous === undefined) delete process.env.WEBBRIDGE_FIXTURE_ENABLE;
    else process.env.WEBBRIDGE_FIXTURE_ENABLE = previous;
    if (previousURL === undefined) delete process.env.WEBBRIDGE_FIXTURE_URL;
    else process.env.WEBBRIDGE_FIXTURE_URL = previousURL;
  }
});

test('fixture plugin refuses non-loopback and URL userinfo without publishing a model', async () => {
  const previous = process.env.WEBBRIDGE_FIXTURE_ENABLE;
  const previousURL = process.env.WEBBRIDGE_FIXTURE_URL;
  process.env.WEBBRIDGE_FIXTURE_ENABLE = '1';
  try {
    for (const url of ['https://example.org/v1', 'http://localhost:8080/v1',
      'http://user:pass@127.0.0.1:3000/v1', 'http://127.0.0.1:3000/v1?token=x']) {
      process.env.WEBBRIDGE_FIXTURE_URL = url;
      const noCalls = new Proxy({}, { get: () => { throw new Error('should not register'); } });
      await assert.rejects(async () => { await fixturePlugin.setup(noCalls as Parameters<typeof fixturePlugin.setup>[0]); }, /explicit 127\.0\.0\.1/);
    }
  } finally {
    if (previous === undefined) delete process.env.WEBBRIDGE_FIXTURE_ENABLE;
    else process.env.WEBBRIDGE_FIXTURE_ENABLE = previous;
    if (previousURL === undefined) delete process.env.WEBBRIDGE_FIXTURE_URL;
    else process.env.WEBBRIDGE_FIXTURE_URL = previousURL;
  }
});
