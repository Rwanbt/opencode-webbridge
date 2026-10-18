import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import root from '../src/index.js';
import probe, { g170OfflineConfig, g170PersonalFinalityGate } from '../src/runtime/g170-native-registration.js';
import { openFixtureServer } from '../src/testing/fixture-inference.js';

const config = (port: number, token = 'a'.repeat(64)) => ({
  WEBBRIDGE_G170_OFFLINE_TEST: '1', WEBBRIDGE_G170_TEST_CONFIRMATION: 'isolated-fixture-only',
  WEBBRIDGE_G170_FIXTURE_TOKEN: token, WEBBRIDGE_G170_FIXTURE_URL: `http://127.0.0.1:${port}/v1`,
});

test('G170 never promotes G166 candidate or uncertain terminal to native finality', () => {
  for (const events of [[], [
    { kind: 'candidate', turnID: 'turn_12345678', messageKey: 'answer1',
      seq: 1, text: 'a visible answer', attribution: 'unverified' },
    { kind: 'terminal', turnID: 'turn_12345678', status: 'uncertain',
      reason: 'provider-finality-unverified' },
  ]]) assert.throws(() => g170PersonalFinalityGate(events as any), /PERSONAL_NO_GO/);
});

test('G170 hostile address and missing explicit fixture authority fail before registration', async () => {
  assert.equal(g170OfflineConfig({}), null);
  for (const value of [
    { WEBBRIDGE_G170_TEST_CONFIRMATION: 'yes' },
    { WEBBRIDGE_G170_FIXTURE_TOKEN: 'not-a-token' },
    { WEBBRIDGE_G170_FIXTURE_URL: 'https://chatgpt.com/v1' },
    { WEBBRIDGE_G170_FIXTURE_URL: 'http://localhost:1234/v1' },
    { WEBBRIDGE_G170_FIXTURE_URL: 'http://127.0.0.1:1234/v1?token=leak' },
  ]) assert.throws(() => g170OfflineConfig({ ...config(1234), ...value }), /G170/);
  let added: any, registrations = 0;
  const ctx: any = { provider: { transform: async (fn: (editor: any) => void) => {
    registrations++; fn({ add: (value: any) => { added = value; } });
    return { dispose: async () => {} };
  } } };
  const old = { ...process.env };
  try {
    process.env = { ...old }; delete process.env.WEBBRIDGE_G170_OFFLINE_TEST;
    await root.setup(ctx); // Production root never imports G170.
    await probe.setup(ctx);
    assert.equal(registrations, 0);
    process.env = { ...old, ...config(9876) };
    const cleanup = await probe.setup(ctx);
    assert.equal(registrations, 1);
    assert.equal(added.info.id, 'webbridge-g170-offline-test');
    assert.equal(added.models.length, 1);
    assert.equal(added.models[0].id, 'webbridge-native-fixture');
    assert.doesNotMatch(JSON.stringify(added), /chatgpt\.com|deepseek|gemini|mistral|qwen/);
    assert.ok(cleanup); await cleanup!();
  } finally { process.env = old; }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test('G170 packaged separate plugin: official CLI 2.0.32 registers and streams ONLY a local verified fixture model', {
  skip: process.platform !== 'linux' || process.env.G170_NATIVE_CLI !== '1',
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'g170-native-'));
  const token = randomBytes(32).toString('hex');
  const prompt = 'G170_OFFLINE_FIXTURE_PROMPT';
  const expected = 'G170_NATIVE_OFFLINE_FIXTURE_COMPLETE';
  const fixture = await openFixtureServer({ token, respond: async (messages) => {
    if (!JSON.stringify(messages).includes(prompt)) throw new Error('wrong fixture request');
    return (async function* () { yield 'G170_NATIVE_'; yield 'OFFLINE_FIXTURE_COMPLETE'; })();
  } });
  let server: ReturnType<typeof spawn> | undefined;
  try {
    const stage = join(temp, 'package');
    await mkdir(join(stage, 'dist/src/runtime'), { recursive: true });
    await cp(join(process.cwd(), 'dist/src/runtime/g170-native-registration.js'),
      join(stage, 'dist/src/runtime/g170-native-registration.js'));
    await writeFile(join(stage, 'index.mjs'),
      'export { default } from "./dist/src/runtime/g170-native-registration.js";\n');
    await writeFile(join(stage, 'package.json'), JSON.stringify({
      name: 'webbridge-g170-test-only', version: '0.0.1', type: 'module',
      main: 'index.mjs', files: ['index.mjs', 'dist/src/runtime'],
      dependencies: { '@opencode/plugin': '2.0.29' },
    }));
    const pack = spawnSync('npm', ['pack', stage, '--json', '--pack-destination', temp,
      '--ignore-scripts'], { encoding: 'utf8', timeout: 90_000 });
    assert.equal(pack.status, 0, pack.stderr.slice(-400));
    const archive = JSON.parse(pack.stdout)[0].filename;
    const profile = join(temp, 'profile');
    const install = spawnSync('npm', ['install', join(temp, archive), '--prefix', profile,
      '--no-save', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund'],
    { encoding: 'utf8', timeout: 120_000 });
    assert.equal(install.status, 0, install.stderr.slice(-400));
    const module = join(profile, 'node_modules/webbridge-g170-test-only');
    assert.equal(JSON.parse(await readFile(join(module, 'package.json'), 'utf8')).version, '0.0.1');
    const conf = join(temp, 'config');
    await Promise.all([mkdir(conf), ...['home', 'data', 'cache'].map((p) => mkdir(join(temp, p)))]);
    const pluginURL = pathToFileURL(module).href;
    const settings = JSON.stringify({ plugins: [pluginURL] });
    await writeFile(join(conf, 'opencode.json'), settings);
    const port = await freePort();
    const password = randomBytes(32).toString('hex');
    const nativeCLI = join(process.cwd(), 'node_modules/.bin/opencode');
    const env = { ...process.env,
      WEBBRIDGE_G170_OFFLINE_TEST: '1',
      WEBBRIDGE_G170_TEST_CONFIRMATION: 'isolated-fixture-only',
      WEBBRIDGE_G170_FIXTURE_TOKEN: token, WEBBRIDGE_G170_FIXTURE_URL: fixture.baseURL,
      HOME: join(temp, 'home'), XDG_CONFIG_HOME: conf, XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), OPENCODE_CONFIG_DIR: conf,
      OPENCODE_CONFIG_CONTENT: settings, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_SERVER_PASSWORD: password };
    server = spawn(nativeCLI, ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let logs = '';
    for (const output of [server.stdout, server.stderr]) output?.on('data', (chunk: Buffer) => {
      logs = (logs + chunk.toString()).slice(-4000);
    });
    const url = `http://127.0.0.1:${port}`;
    const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') };
    let active = false, listed = false;
    for (let attempt = 0; attempt < 100 && server.exitCode === null; attempt++) {
      try {
        const response = await fetch(url + '/api/plugin', { headers, signal: AbortSignal.timeout(700) });
        if (response.ok) active = (await response.json()).data.some((p: any) =>
          p.id === 'opencode.webbridge.g170-native-probe' && p.state?.status === 'active');
        const providers = await fetch(url + '/api/provider', { headers, signal: AbortSignal.timeout(700) });
        if (providers.ok) {
          const inventory = JSON.stringify(await providers.json());
          listed = inventory.includes('webbridge-g170-offline-test');
          assert.doesNotMatch(inventory, /webbridge-(chatgpt|gemini|deepseek|qwen|mistral)/);
        }
        if (active && listed) break;
      } catch { /* only startup; no fake model success */ }
      await new Promise<void>((done) => setTimeout(done, 150));
    }
    assert.equal(active && listed, true, 'G170 plugin/model absent from official CLI inventory: ' + logs.slice(-500));
    const child = spawn(nativeCLI, ['run', '--server', url, '--model',
      'webbridge-g170-offline-test/webbridge-native-fixture', '--format', 'json', prompt],
    { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const done = new Promise<number | null>((resolve, reject) => {
      child.stdout?.on('data', (b: Buffer) => { stdout = (stdout + b).slice(-100_000); });
      child.stderr?.on('data', (b: Buffer) => { stderr = (stderr + b).slice(-2000); });
      child.once('error', reject); child.once('close', resolve);
    });
    const timer = setTimeout(() => child.kill(), 45_000);
    let exit: number | null;
    try { exit = await done; } finally { clearTimeout(timer); }
    assert.equal(exit, 0, 'official CLI model failure: ' + stderr.slice(-350));
    assert.ok(stdout.includes(expected), 'official CLI omitted terminal-bound offline fixture output');
    assert.ok(fixture.requests() > 0 && fixture.streamFrames() >= 2 && fixture.completedStreams() > 0);
  } finally {
    if (server?.exitCode === null) server.kill();
    await fixture.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
