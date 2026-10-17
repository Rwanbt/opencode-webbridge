/** G143: package the ACTUAL src/index.ts output in a disposable OpenCode profile.
 * Never installs into or recompiles the user's official OpenCode application.
 * The current public entrypoint is intentionally inert (no model/RPC/tool). */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedEnvironment } from './offline-package-preview.mjs';
import { runCLI } from './smoke-packaged-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'opencode-webbridge';
const id = 'opencode.webbridge';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const integrity = (bytes) => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

export function actualManifest(version) {
  if (!/^0\.0\.[1-9][0-9]*$/.test(version)) throw new Error('invalid disposable package version');
  return Object.freeze({
    name, version, type: 'module', main: 'index.mjs',
    license: 'MIT', files: ['index.mjs', 'g97-local.mjs', 'LICENSE'],
    dependencies: { '@opencode/plugin': '2.0.29' },
    description: 'Real root: inert by default; explicit localhost fixture only, commercial providers disabled',
  });
}

export function sourceContract(text) {
  if (typeof text !== 'string' || text.length > 20_000 ||
      !text.includes('import { Plugin } from "@opencode/plugin"') ||
      !text.includes('id: "opencode.webbridge"') ||
      !text.includes('setup(ctx)') ||
      !text.includes('WEBBRIDGE_G150_LOCAL_FIXTURE') ||
      /provider\.transform|rpc\.register|browser\.navigate|browser\.click|child_process|WEBBRIDGE_FIXTURE_ENABLE/.test(text))
    throw new Error('actual root plugin changed: re-review public entrypoint and release gates');
  return Object.freeze({ entrySHA256: hash(Buffer.from(text)), id, transportActive: false });
}

function npm(args, env, cwd) {
  const npmPath = process.env.npm_execpath;
  if (!npmPath || !/npm-cli\.js$/i.test(npmPath) || !existsSync(npmPath))
    throw new Error('npm CLI must be invoked through a repository npm script');
  const outcome = spawnSync(process.execPath, [npmPath, ...args], {
    cwd, env, encoding: 'utf8', timeout: 180_000, windowsHide: true,
    maxBuffer: 300_000,
  });
  if (outcome.error || outcome.status !== 0)
    throw new Error('isolated npm ' + args[0] + ' failed: ' +
      (outcome.error?.code ?? outcome.status) + ' ' + (outcome.stderr ?? '').slice(-350));
  return outcome.stdout;
}

async function packageActual(temp, label, version, entry, env) {
  const source = join(temp, 'package-' + label);
  const output = join(temp, 'archives-' + label);
  await Promise.all([mkdir(source), mkdir(output)]);
  await Promise.all([
    writeFile(join(source, 'index.mjs'), entry),
    copyFile(join(root, 'fixtures/g97-combined-preview.mjs'), join(source, 'g97-local.mjs')),
    writeFile(join(source, 'package.json'), JSON.stringify(actualManifest(version)) + '\n'),
    copyFile(join(root, 'LICENSE'), join(source, 'LICENSE')),
  ]);
  const [meta] = JSON.parse(npm(['pack', source, '--pack-destination', output,
    '--ignore-scripts', '--json', '--offline'], env, temp));
  if (meta?.name !== name || meta.version !== version ||
      meta.files?.length !== 4 ||
      meta.files.some((f) => !['index.mjs', 'g97-local.mjs', 'package.json', 'LICENSE'].includes(f.path)))
    throw new Error('distribution archive contains an unexpected entry');
  const path = join(output, meta.filename);
  const bytes = await readFile(path);
  if (meta.integrity !== integrity(bytes)) throw new Error('npm archive SHA512 mismatch');
  return Object.freeze({ path, sha256: hash(bytes), version });
}

async function install(item, env, temp, prefix) {
  if (hash(await readFile(item.path)) !== item.sha256)
    throw new Error('distribution SHA256 mismatch: refuse before npm');
  npm(['install', item.path, '--prefix', prefix, '--ignore-scripts', '--no-save',
    '--no-package-lock', '--no-audit', '--no-fund'], env, temp);
  const location = join(prefix, 'node_modules', name);
  const manifest = JSON.parse(await readFile(join(location, 'package.json'), 'utf8'));
  const entry = await readFile(join(location, 'index.mjs'), 'utf8');
  if (manifest.version !== item.version || manifest.dependencies?.['@opencode/plugin'] !== '2.0.29')
    throw new Error('installed root package manifest mismatch');
  const sdk = JSON.parse(await readFile(join(prefix, 'node_modules',
    '@opencode', 'plugin', 'package.json'), 'utf8'));
  if (sdk.name !== '@opencode/plugin' || sdk.version !== '2.0.29')
    throw new Error('installed SDK version differs from tested exact pin');
  return { location, entry };
}

async function nativeProof(temp, env, entry, bin, fixture) {
  if (!bin || !existsSync(bin)) throw new Error('exact official CLI binary missing');
  const configDir = join(temp, fixture ? 'native-config-local' : 'native-config');
  await mkdir(configDir);
  const config = JSON.stringify({ plugins: [pathToFileURL(entry).href] });
  const password = randomBytes(32).toString('hex');
  const sandbox = { ...env, OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: config,
    OPENCODE_SERVER_PASSWORD: password, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    ...(fixture?.env ?? {}) };
  await writeFile(join(configDir, 'opencode.json'), config);
  // Reserve then release a loopback port; no special OpenCode app instance
  // or user browser is created. Tests run inside a disposable CI profile.
  const socket = createServer();
  await new Promise((resolveDone, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolveDone);
  });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  const running = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temp, env: sandbox, stdio: ['ignore','pipe','pipe'], windowsHide: true, shell: false,
  });
  let stderr = '';
  for (const pipe of [running.stdout, running.stderr])
    pipe.on('data', (bytes) => { stderr = (stderr + bytes.toString('utf8')).slice(-2000); });
  const base = 'http://127.0.0.1:' + port;
  const headers = { Authorization: 'Basic ' +
    Buffer.from('opencode:' + password).toString('base64') };
  try {
    let pluginLoaded = false;
    for (let i = 0; i < 80 && running.exitCode === null; i++) {
      try {
        const response = await fetch(base + '/api/plugin', {
          headers, signal: AbortSignal.timeout(700),
        });
        if (response.ok) {
          const body = await response.json();
          pluginLoaded = Array.isArray(body?.data) &&
            body.data.some((p) => p.id === id && p.state?.status === 'active');
          if (pluginLoaded) break;
        }
      } catch { /* startup retry, no fake success */ }
      await new Promise((done) => setTimeout(done, 150));
    }
    if (!pluginLoaded) throw new Error('actual installed plugin not active in official CLI: ' +
      stderr.replaceAll(password, '[REDACTED]').slice(-900));
    const provider = await fetch(base + '/api/provider', {
      headers, signal: AbortSignal.timeout(3000),
    });
    if (!provider.ok) throw new Error('official provider inventory inaccessible');
    const models = JSON.stringify(await provider.json());
    if (!fixture && /webbridge-fixture|webbridge-native-fixture|webbridge-g99-page/i.test(models))
      throw new Error('inert distributed entrypoint unexpectedly advertised fixture model');
    if (fixture) {
      if (!models.includes('webbridge-native-fixture'))
        throw new Error('G150 opt-in failed to register model in actual root');
      const headersJSON = { ...headers, 'Content-Type': 'application/json' };
      const call = (scope, secret, nonce) => fetch(
        base + '/api/rpc/webbridge-g81-package/challenge', {
          method: 'POST', headers: headersJSON, signal: AbortSignal.timeout(3000),
          body: JSON.stringify({ input: { scope, secret, nonce } }),
        });
      const nonce = 'g150_local_nonce';
      const bad = await call('other-workspace', fixture.env.WEBBRIDGE_G81_SECRET, nonce);
      if (bad.ok) throw new Error('G150 forged workspace obtained native RPC receipt');
      const answer = await call('g81-local-profile', fixture.env.WEBBRIDGE_G81_SECRET, nonce);
      const expected = createHmac('sha256', fixture.env.WEBBRIDGE_G81_SECRET).update(nonce).digest('hex');
      if (!answer.ok || (await answer.json())?.output?.receipt !== expected)
        throw new Error('G150 actual root RPC response not host-scoped');
      const duplicate = await call('g81-local-profile', fixture.env.WEBBRIDGE_G81_SECRET, nonce);
      if (duplicate.ok) throw new Error('G150 native RPC replay admitted');
      const run = await runCLI(bin, ['run', '--server', base, '--model',
        'webbridge-fixture/webbridge-native-fixture', '--format', 'json',
        'G150_LOCAL_TEST_MODEL_PROMPT'], sandbox, temp, { timeoutMs: 50_000 });
      if (run.code !== 0 || !run.stdout.includes('G150_ACTUAL_ROOT_LOCAL_OK') ||
          !fixture.requests()) throw new Error('G150 selected actual root fixture model CLI native SSE failed');
    }
    return Object.freeze({ officialCLI: true, rootPluginActive: true,
      advertisedCommercialProviders: 0, fixtureModelRegistered: Boolean(fixture),
      ...(fixture ? { fixtureNativeRpc: true, fixtureModelSSE: true } : {}) });
  } finally {
    if (running.exitCode === null) running.kill();
    await Promise.race([
      new Promise((done) => running.once('close', done)),
      new Promise((done) => setTimeout(done, 3000)),
    ]);
  }
}

export async function proveActualEntrypoint({ native = false } = {}) {
  const entry = await readFile(join(root, 'dist/src/index.js'), 'utf8');
  const source = sourceContract(entry);
  const temp = await mkdtemp(join(tmpdir(), 'webbridge-actual-plugin-'));
  const env = { ...isolatedEnvironment(temp), npm_config_offline: 'false' };
  try {
    await Promise.all(['home','tmp','appdata','localappdata'].map((p) => mkdir(join(temp,p))));
    await Promise.all(['blank.npmrc','blank-global.npmrc'].map((p) =>
      writeFile(join(temp,p),'\n')));
    const first = await packageActual(temp, 'original', '0.0.1', entry, env);
    const repeated = await packageActual(temp, 'identical', '0.0.1', entry, env);
    if (first.sha256 !== repeated.sha256) throw new Error('actual root archive not reproducible');
    const upgraded = await packageActual(temp, 'upgrade', '0.0.2', entry, env);
    if (first.sha256 === upgraded.sha256) throw new Error('version upgrade not distinguishable');
    if (!native) return { ...source, reproducible: true,
      packedSHA256: first.sha256, realNativeCLI: false, commercialOperational: 0 };
    const profile = join(temp, 'profile');
    await mkdir(profile);
    const original = await install(first, env, temp, profile);
    if (original.entry !== entry) throw new Error('installed root differs from source');
    await install(upgraded, env, temp, profile);
    const tampered = join(temp, 'tampered.tgz');
    await copyFile(first.path, tampered);
    await writeFile(tampered, Buffer.concat([await readFile(tampered), Buffer.from('tampered')]));
    let rejected = false;
    try { await install({ ...first, path: tampered }, env, temp, profile); }
    catch (error) {
      if (!/SHA256 mismatch/.test(String(error))) throw error;
      rejected = true;
    }
    if (!rejected) throw new Error('tampered package accepted');
    const restored = await install(first, env, temp, profile);
    if (restored.entry !== entry) throw new Error('rollback failed source parity');
    const nativeBin = join(root, 'node_modules', '.bin', 'opencode');
    const proof = await nativeProof(temp, env, restored.location, nativeBin);
    const { openFixtureServer } = await import(pathToFileURL(
      join(root, 'dist/src/testing/fixture-inference.js')).href);
    const token = randomBytes(32).toString('hex');
    const fake = await openFixtureServer({ token,
      respond: async () => (async function* () {
        yield 'G150_ACTUAL_ROOT_';
        yield 'LOCAL_OK';
      })(),
    });
    let local;
    try {
      local = await nativeProof(temp, env, restored.location, nativeBin, {
        env: { WEBBRIDGE_G150_LOCAL_FIXTURE: '1', WEBBRIDGE_G81_TEST_ONLY: '1',
          WEBBRIDGE_FIXTURE_ENABLE: '1',
          WEBBRIDGE_G81_SECRET: randomBytes(32).toString('hex'),
          WEBBRIDGE_FIXTURE_TOKEN: token, WEBBRIDGE_FIXTURE_URL: fake.baseURL },
        requests: () => fake.requests(),
      });
    } finally { await fake.close(); }
    if (!local.fixtureNativeRpc || !local.fixtureModelSSE ||
        !proof.rootPluginActive || proof.fixtureModelRegistered)
      throw new Error('G150 default-on vs opt-in contract violated');
    npm(['uninstall', name, '--prefix', profile, '--no-save',
      '--ignore-scripts','--no-package-lock','--no-audit','--no-fund'], env, temp);
    if (existsSync(restored.location)) throw new Error('real plugin uninstall left package behind');
    return { ...source, ...proof, localOptIn: local, reproducible: true,
      upgraded: true, rolledBack: true, tamperDenied: true, uninstalled: true };
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  proveActualEntrypoint({ native: process.argv.includes('--native') })
    .then((proof) => console.log('G143 actual root plugin package PASS', JSON.stringify(proof)))
    .catch((error) => { console.error('G143 actual root plugin NO-GO:', error.message); process.exitCode = 1; });
}
