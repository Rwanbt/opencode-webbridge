import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const gate = await import(pathToFileURL(resolve('scripts/g92-desktop-preflight.mjs')).href);
const ok = {
  running: 0, desktop: true, cli: true, marker: '2.0.32',
  version: '2.0.32', signedDesktop: true, signedCLI: true,
  sameSigner: true, installPathSafe: true,
};

test('G92 below 6 GiB never even invokes a Windows process/signature probe', () => {
  let attempts = 0;
  const inspect = () => { attempts++; return ok; };
  const low = gate.preflight({ platform: 'win32', freeBytes: gate.MIN_FREE_BYTES - 1, inspect });
  assert.equal(low.status, 'SKIP_UNSAFE');
  assert.equal(low.desktopExecuted, false);
  assert.deepEqual(low.reasons, ['free-memory-below-6-GiB-or-unknown']);
  assert.equal(attempts, 0);
  assert.equal(gate.preflight({ platform: 'linux', freeBytes: gate.MIN_FREE_BYTES * 2, inspect }).status, 'SKIP_UNSAFE');
  assert.equal(attempts, 0);
  assert.equal(gate.preflight({ platform: 'win32', freeBytes: NaN, inspect }).status, 'SKIP_UNSAFE');
  assert.equal(attempts, 0);
});

test('G92 denies active Desktop, unexpected version or signer, reparse and probe failures', () => {
  const decide = (snapshot: typeof ok) => gate.decision({
    platform: 'win32', freeBytes: gate.MIN_FREE_BYTES, snapshot,
  });
  const ready = decide(ok);
  assert.equal(ready.status, 'REVIEW_ONLY');
  assert.equal(ready.proof, 'NO_ELECTRON_E2E');
  assert.equal(ready.desktopExecuted, false);
  for (const snapshot of [
    { ...ok, running: 1 }, { ...ok, running: -1 },
    { ...ok, desktop: false }, { ...ok, cli: false },
    { ...ok, marker: '2.0.31' }, { ...ok, version: '2.0.31' },
    { ...ok, signedDesktop: false }, { ...ok, signedCLI: false },
    { ...ok, sameSigner: false }, { ...ok, installPathSafe: false },
  ]) {
    assert.equal(decide(snapshot).status, 'SKIP_UNSAFE');
  }
  assert.equal(gate.preflight({ platform: 'win32',
    freeBytes: gate.MIN_FREE_BYTES * 2, inspect: () => { throw new Error('probe down'); } }).status, 'SKIP_UNSAFE');
});

test('G92 disposable staged RPC fixture cannot inherit user secrets and cleans only its sandbox', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'g92-outside-sentinel-'));
  const sentinel = join(outside, 'unchanged.txt');
  await writeFile(sentinel, 'PERSONAL_UNTOUCHED');
  let sandbox = '';
  try {
    await gate.withDisposableProfile(async (profile: {
      sandbox: string; env: Record<string, string>; moduleDir: string;
      config: { plugins: string[] };
    }) => {
      sandbox = profile.sandbox;
      assert.ok(sandbox.includes('g92-desktop-isolation-'));
      assert.equal(profile.env.APPDATA.startsWith(sandbox), true);
      assert.equal(profile.env.LOCALAPPDATA.startsWith(sandbox), true);
      assert.equal(profile.env.OPENCODE_DB.startsWith(sandbox), true);
      assert.equal(profile.env.WEBBRIDGE_G81_TEST_ONLY, '1');
      assert.match(profile.env.WEBBRIDGE_G81_SECRET, /^[a-f0-9]{64}$/);
      assert.equal(profile.env.OPENAI_API_KEY, undefined);
      assert.equal(profile.env.GITHUB_TOKEN, undefined);
      assert.equal(profile.env.OPENCODE_DESKTOP_TEST_ROOT, undefined);
      assert.equal(profile.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
      assert.deepEqual(Object.keys(profile.config), ['plugins']);
      assert.equal(profile.config.plugins.length, 1);
      assert.match(await readFile(join(profile.moduleDir, 'index.mjs'), 'utf8'), /g81-local-profile/);
      assert.equal(await readFile(sentinel, 'utf8'), 'PERSONAL_UNTOUCHED');
    }, { PATH: 'safe', OPENAI_API_KEY: 'private',
      GITHUB_TOKEN: 'private', OPENCODE_CONFIG_DIR: 'real-profile',
      OPENCODE_DESKTOP_TEST_ROOT: 'real-desktop', OTEL_EXPORTER_OTLP_ENDPOINT: 'external' });
    assert.equal(existsSync(sandbox), false);
    assert.equal(await readFile(sentinel, 'utf8'), 'PERSONAL_UNTOUCHED');
    await assert.rejects(gate.withDisposableProfile(async (profile: { sandbox: string }) => {
      sandbox = profile.sandbox;
      throw new Error('negative fail');
    }), /negative fail/);
    assert.equal(existsSync(sandbox), false);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
