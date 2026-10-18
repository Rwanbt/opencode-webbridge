import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import webbridge from '../src/index.js';

const keys = ['WEBBRIDGE_G150_LOCAL_FIXTURE', 'WEBBRIDGE_G81_TEST_ONLY',
  'WEBBRIDGE_G81_SECRET', 'WEBBRIDGE_FIXTURE_TOKEN', 'WEBBRIDGE_FIXTURE_URL'];
async function scenario(values: Record<string, string>, run: () => Promise<void>) {
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}
const data = {
  WEBBRIDGE_G150_LOCAL_FIXTURE: '1', WEBBRIDGE_G81_TEST_ONLY: '1',
  WEBBRIDGE_G81_SECRET: 'a'.repeat(64), WEBBRIDGE_FIXTURE_TOKEN: 'b'.repeat(64),
  WEBBRIDGE_FIXTURE_URL: 'http://127.0.0.1:12345/v1',
};
test('actual distributed root has zero active adapters unless explicitly opted in', async () => {
  await scenario({}, async () => {
    assert.equal(await webbridge.setup({} as never), undefined);
  });
});
test('root rejects incomplete or forged local test authority before any provider/RPC registration', async () => {
  for (const invalid of [
    { WEBBRIDGE_G150_LOCAL_FIXTURE: '1' },
    { ...data, WEBBRIDGE_G81_SECRET: 'not-256bit' },
    { ...data, WEBBRIDGE_G81_TEST_ONLY: '0' },
  ]) await scenario(invalid, async () => {
    await assert.rejects(async () => { await webbridge.setup({} as never); }, /authorization missing/);
  });
});
test('root rejects all non-loopback network endpoints before initializing fixture', async () => {
  for (const url of ['https://chatgpt.com/v1', 'http://localhost:12345/v1',
    'http://127.0.0.1.evil.example/v1', 'http://127.0.0.1:12345/admin',
    'http://user:password@127.0.0.1:12345/v1', 'http://127.0.0.1:12345/v1?token=abc']) {
    await scenario({ ...data, WEBBRIDGE_FIXTURE_URL: url }, async () => {
      await assert.rejects(async () => { await webbridge.setup({} as never); }, /external model endpoint forbidden/);
    });
  }
});
