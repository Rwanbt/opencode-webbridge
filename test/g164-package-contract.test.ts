import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';

const base = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
test('G164 pack main must be emitted, not raw TS and never the test harness', async () => {
  const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './index.mjs');
  assert.equal(manifest.types, './dist/src/index.d.ts');
  assert.ok(manifest.files.includes('index.mjs'));
  assert.ok(manifest.files.includes('dist/src/'));
  const wrapper = await readFile(join(base, 'index.mjs'), 'utf8');
  assert.match(wrapper, /export \{ default \} from '\.\/dist\/src\/index\.js';/);
  assert.equal(manifest.scripts.prepack, 'node scripts/g164-prepare-package.mjs');
  assert.equal(manifest.dependencies['@opencode/plugin'], '2.0.29');
  assert.equal(manifest.dependencies.effect, '4.0.1');
  assert.equal(manifest.dependencies.playwright, '1.64.1');
  assert.equal(manifest.devDependencies.playwright, undefined);
  assert.equal(manifest.private, true, 'do not publish unqualified commercial integration');
  const tsconfig = JSON.parse(await readFile(join(base, 'tsconfig.pack.json'), 'utf8'));
  assert.deepEqual(tsconfig.include, ['src/index.ts', 'src/runtime/g166-chatgpt-manual-turn.ts']);
  assert.equal(manifest.bin['webbridge-manual-chatgpt'], './bin/webbridge-manual-chatgpt.mjs');
  assert.ok(manifest.files.includes('bin/'));
  assert.ok(tsconfig.exclude.includes('test'));
  assert.ok(tsconfig.exclude.includes('src/testing'));
});
