import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// scripts/*.mjs are maintained as raw ESM, not emitted under dist/ by tsc.
const { actualManifest, sourceContract } =
  await import(pathToFileURL(resolve('scripts/smoke-distributed-entrypoint.mjs')).href);

test('actual plugin manifest includes only pinned SDK and inert root source', () => {
  const source = readFileSync(join(process.cwd(), 'dist', 'src', 'index.js'), 'utf8');
  const info = sourceContract(source);
  assert.equal(info.id, 'opencode.webbridge');
  assert.equal(info.transportActive, false);
  assert.match(info.entrySHA256, /^[a-f0-9]{64}$/);
  const m = actualManifest('0.0.1');
  assert.equal(m.name, 'opencode-webbridge');
  assert.equal(m.main, 'index.mjs');
  assert.equal(m.dependencies['@opencode/plugin'], '2.0.29');
  assert.deepEqual(m.files, ['index.mjs', 'LICENSE']);
  assert.equal(Object.isFrozen(m), true);
});

test('commercial registration or injected executable effects cannot pass source guard', () => {
  const source = readFileSync(join(process.cwd(), 'dist', 'src', 'index.js'), 'utf8');
  for (const addition of ['provider.transform(() => {})', 'rpc.register({})',
    'browser.navigate("https://example.com")', 'WEBBRIDGE_FIXTURE_ENABLE=1']) {
    assert.throws(() => sourceContract(source + '\n' + addition), /re-review/);
  }
  for (const bad of ['1.0.0', '0.0.0', 'latest', '../0.0.1']) {
    assert.throws(() => actualManifest(bad), /invalid/);
  }
});
