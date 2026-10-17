/** G81: reproducible RPC fixture package and real native OpenCode v2 RPC proof, offline. */
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npmCLI, isolatedEnvironment, pack, install, installed } from './offline-package-preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = { name: 'opencode-webbridge-g81-rpc-test',
  id: 'opencode.webbridge.rpc-package-fixture',
  entry: await readFile(join(root, 'fixtures/g81-rpc-preview.mjs'), 'utf8'),
  description: 'TEST-ONLY offline authenticated RPC fixture; NO browser/model/commercial provider' };
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const socket = createServer();
  await new Promise((ok, fail) => {
    socket.once('error', fail);
    socket.listen(0, '127.0.0.1', ok);
  });
  const port = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  return port;
}

async function smokeNative(profile, env, temp, executable, version, modelBridge, descriptor, scenario = 'normal') {
  const configDir = join(temp, 'native-g81');
  await mkdir(configDir, { recursive: true });
  const packageDir = join(profile, 'node_modules', descriptor.name);
  const extra = modelBridge ? await modelBridge.prepare({ temp, env, version, scenario }) : undefined;
  const config = JSON.stringify({ plugins: [pathToFileURL(packageDir).href,
    ...(extra?.modelPluginDir ? [pathToFileURL(extra.modelPluginDir).href] : [])] });
  await writeFile(join(configDir, 'opencode.json'), config);
  const password = randomBytes(32).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const sandbox = { ...env, OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: config,
    OPENCODE_SERVER_PASSWORD: password, WEBBRIDGE_G81_TEST_ONLY: '1', WEBBRIDGE_G81_SECRET: secret,
    ...extra?.env };
  const port = await freePort();
  const server = spawn(executable, ['serve', '--print-logs', '--log-level', 'debug',
    '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temp, env: sandbox, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && /\.cmd$/i.test(executable),
  });
  let inventorySummary = 'none';
  const pluginDiagnostics = [];
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (data) => {
      for (const line of data.toString('utf8').split(/\r?\n/)) {
        if (/plugin|rpc|fail|error|warn/i.test(line)) {
          pluginDiagnostics.push(line.slice(0, 450));
          if (pluginDiagnostics.length > 80) pluginDiagnostics.shift();
        }
      }
    });
  }
  const url = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
  try {
    let registered = false;
    for (let i = 0; i < 75 && server.exitCode === null; i++) {
      try {
        const response = await fetch(`${url}/api/plugin`, { headers, signal: AbortSignal.timeout(600) });
        if (response.ok) {
          const inventory = await response.json();
          // Official pinned v2 Location.response(Plugin.Info[]) = {location, data}.
          const entries = Array.isArray(inventory?.data) ? inventory.data : [];
          inventorySummary = JSON.stringify(entries.filter((item) =>
            /webbridge|failed/i.test(item?.id ?? '')).map((item) =>
            ({ id: item.id, state: item.state }))).slice(-700);
          registered = entries.some((item) =>
            item?.id === descriptor.id && item?.state?.status === 'active');
          if (registered) break;
        }
      } catch { /* bounded native startup */ }
      await pause(200);
    }
    if (!registered) throw new Error(`native G81 installed plugin not active; inventory=${inventorySummary}`);
    const request = (scope, nonce, capability = secret) =>
      fetch(`${url}/api/rpc/webbridge-g81-package/challenge`, {
        method: 'POST', headers, body: JSON.stringify({ input: { secret: capability, scope, nonce } }),
        signal: AbortSignal.timeout(4000),
      });
    const receipt = (nonce) => createHmac('sha256', secret).update(nonce).digest('hex');
    const nonce = `nonce_${version.replaceAll('.', '_')}`;
    const foreign = await request('foreign-workspace', nonce);
    const foreignBody = await foreign.text();
    if (foreign.ok && foreignBody.includes(receipt(nonce))) {
      throw new Error('foreign scope acquired native RPC authority');
    }
    const wrong = await request('g81-local-profile', nonce, '0'.repeat(64));
    const wrongBody = await wrong.text();
    if (wrong.ok && wrongBody.includes(receipt(nonce))) {
      throw new Error('forged capability acquired native RPC authority');
    }
    const ok = await request('g81-local-profile', nonce);
    if (!ok.ok || (await ok.json())?.output?.receipt !== receipt(nonce)) {
      throw new Error('native RPC challenge did not produce authenticated HMAC receipt');
    }
    const replay = await request('g81-local-profile', nonce);
    const replayBody = await replay.text();
    if (replay.ok && replayBody.includes(receipt(nonce))) {
      throw new Error('native RPC replay produced second receipt');
    }
    const model = extra ? await extra.verify({ url, headers, secret, executable, env: sandbox, temp,
      version }) : undefined;
    return { version, nativeRpc: true, wrongScopeDenied: true, wrongSecretDenied: true,
      replayDenied: true, ...(model ? { model } : {}) };
  } catch (error) {
    const clean = (pluginDiagnostics.slice(0, 16).join('\n') + '\n' + String(error))
      .replaceAll(password, '[REDACTED]').replaceAll(secret, '[REDACTED]');
    throw new Error(`native G81 RPC package check failed: ${clean.slice(-2500)}`);
  } finally {
    if (server.exitCode === null) {
      if (process.platform === 'win32' && server.pid) {
        spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      } else server.kill();
    }
    await Promise.race([new Promise((ok) => server.once('close', ok)), pause(3000)]);
    await extra?.close();
  }
}

export async function exerciseRPCPackage({ nativeBin, modelBridge, descriptor = fixture,
  adversarialScenario } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'webbridge-g81-rpc-package-'));
  const env = isolatedEnvironment(temp);
  try {
    await Promise.all(['home', 'tmp', 'appdata', 'localappdata'].map((dir) => mkdir(join(temp, dir))));
    await Promise.all(['blank.npmrc', 'blank-global.npmrc'].map((file) => writeFile(join(temp, file), '')));
    const a = await pack(temp, '0.0.1', 'original', env, descriptor);
    const repeat = await pack(temp, '0.0.1', 'repeat', env, descriptor);
    if (a.hash !== repeat.hash) throw new Error('RPC tarball is not reproducible');
    const b = await pack(temp, '0.0.2', 'upgrade', env, descriptor);
    if (a.hash === b.hash) throw new Error('RPC upgrade hash did not change');
    const profile = join(temp, 'profile');
    await mkdir(profile);
    await install(a, a.hash, env, temp, profile, descriptor);
    await install(b, b.hash, env, temp, profile, descriptor);
    const corrupt = join(temp, 'corrupted.tgz');
    await copyFile(a.tarball, corrupt);
    await writeFile(corrupt, Buffer.concat([await readFile(corrupt), Buffer.from('corrupt')]));
    let denied = false;
    try { await install({ ...a, tarball: corrupt }, a.hash, env, temp, profile, descriptor); }
    catch (error) { if (!/SHA256 mismatch/.test(String(error))) throw error; denied = true; }
    if (!denied || await installed(profile, descriptor) !== '0.0.2') {
      throw new Error('corrupt archive changed the active RPC package');
    }
    const upgrade = nativeBin ? await smokeNative(profile, env, temp, nativeBin, '0.0.2', modelBridge, descriptor) : undefined;
    await install(a, a.hash, env, temp, profile, descriptor);
    const rollback = nativeBin ? await smokeNative(profile, env, temp, nativeBin, '0.0.1', modelBridge, descriptor) : undefined;
    const adversarial = nativeBin && adversarialScenario
      ? await smokeNative(profile, env, temp, nativeBin, '0.0.1', modelBridge, descriptor, adversarialScenario)
      : undefined;
    npmCLI(['uninstall', descriptor.name, '--prefix', profile, '--offline', '--ignore-scripts',
      '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], env, temp);
    if (existsSync(join(profile, 'node_modules', descriptor.name))) throw new Error('RPC fixture uninstall failed');
    return { sha256: a.hash, upgraded: true, rollback: true, tamperDenied: denied,
      uninstalled: true, native: Boolean(nativeBin), nativeChecks: [upgrade, rollback].filter(Boolean),
      adversarial: adversarial?.model };
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const native = process.argv.includes('--native');
  const executable = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  if (native && !existsSync(executable)) throw new Error('pinned repository-local OpenCode CLI required');
  exerciseRPCPackage({ nativeBin: native ? executable : undefined })
    .then((result) => console.log('G81 packaged native RPC PASS', JSON.stringify(result)))
    .catch((error) => { console.error('G81 packaged native RPC FAIL:', error.message); process.exitCode = 1; });
}
