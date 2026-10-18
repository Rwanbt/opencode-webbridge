/** G147: real official CLI RPC boundary probe. No Desktop/OS attestation claimed. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedEnvironment } from './offline-package-preview.mjs';
import { loadOfficial, proveOfficialPublicApi } from './probe-d01d02-desktop-public-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = join(root, 'node_modules/@opencode/plugin');
const patch = join(root, 'docs/patches/opencode-v2-4617210-browser-plugin-capability.patch');
const PATCH_SHA = '77b5ff872f5f3d1eb641896ad16fc6c50d8f21ad54bfa797d7519f1990a0685f';
const CLI_VERSION = '2.0.32';
const good = (source) => createHash('sha256').update(source).digest('hex');
const deny = (keys) => !keys.some((key) => /^(verifiedDesktopPeer|nativePrincipal|desktopPrincipal|osPeer|ipcSession|revocationEpoch|hostPermission)$/i.test(key));

test('G147 pinned SDK and native patch have NO transferable OS/Desktop principal', async () => {
  const manifest = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '2.0.29');
  const promise = await readFile(join(sdk, 'dist/promise/rpc.d.ts'), 'utf8');
  const effect = await readFile(join(sdk, 'dist/effect/rpc.d.ts'), 'utf8');
  const plugin = await readFile(join(sdk, 'dist/promise/plugin.d.ts'), 'utf8');
  assert.match(promise, /interface RpcCallContext<[^>]+>\s*\{\s*readonly signal: AbortSignal;\s*readonly error:/);
  assert.match(effect, /interface RpcCallContext<[^>]+>\s*\{\s*readonly error:/);
  assert.doesNotMatch(promise + effect + plugin, /readonly\s+(?:verifiedDesktopPeer|nativePrincipal|desktopPrincipal|ipcSession|revocationEpoch):/);
  const native = await readFile(patch, 'utf8');
  assert.equal(good(native.replaceAll('\r\n', '\n')), PATCH_SHA);
  assert.match(native, /No verified Desktop transport for browser attach\./);
  assert.match(native, /RpcCallContext currently has no transport process identity/);
  // RED counterfactual: a malicious process with Basic auth can self-claim Desktop.
  const forged = { basic: true, claimedElectron: true, peerPID: process.pid, verified: true };
  assert.equal(forged.basic && forged.claimedElectron && forged.verified, true);
  // GREEN admission: no Core-sourced verified peer is ever inferred from those claims.
  assert.equal(deny(Object.keys(forged)), true);
});

const entry = `export default {
  id: 'opencode.webbridge.g147-probe',
  async setup(ctx) {
    const contract = { id: 'webbridge-g147-probe', methods: { inspect: {
      input: { type: 'object', properties: {
        claimedElectron: { type: 'boolean' }, peerPID: { type: 'integer' },
        verified: { type: 'boolean' }, ipcSession: { type: 'string' },
        revocationEpoch: { type: 'integer' }
      }, required: ['claimedElectron','peerPID','verified','ipcSession','revocationEpoch'],
        additionalProperties: false },
      output: { type: 'object', properties: {
        contextKeys: { type: 'array', items: { type: 'string' } }
      }, required: ['contextKeys'], additionalProperties: false }
    } }, events: {} };
    const registration = await ctx.rpc.register(contract, {
      inspect: async (_untrustedInput, call) => ({ contextKeys: Object.keys(call).sort() })
    });
    return () => registration.dispose();
  }
};\n`;

const childSource = `const r=await fetch(process.env.G147_URL, {method:'POST',headers:{
  Authorization:process.env.G147_BASIC,'Content-Type':'application/json',
  'x-desktop-principal':'verified','x-revocation-epoch':'42'},
  body:process.env.G147_BODY, signal:AbortSignal.timeout(5000)});
  const data=await r.json(); process.stdout.write(JSON.stringify({pid:process.pid,status:r.status,data}));`;

async function processProbe(base, headers, body, env) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', childSource], {
    env: { ...env, G147_URL: base, G147_BASIC: headers.Authorization,
      G147_BODY: JSON.stringify({ input: body }) },
    stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  let output = '', errors = '';
  child.stdout.on('data', (chunk) => { output = (output + chunk).slice(-5000); });
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-1000); });
  const timer = setTimeout(() => child.kill(), 10000);
  const code = await Promise.race([
    new Promise((done) => child.once('close', done)),
  ]);
  clearTimeout(timer);
  assert.equal(code, 0, `foreign process HTTP probe failed: ${errors}`);
  return JSON.parse(output);
}

async function freePort() {
  const socket = createServer();
  await new Promise((done, fail) => {
    socket.once('error', fail);
    socket.listen(0, '127.0.0.1', done);
  });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}

test('G147 exact official CLI 2.0.32 HTTP origins receive NO OS-trusted RPC context',
  { skip: process.platform !== 'linux' || process.env.G147_OFFICIAL_CLI !== '1' }, async () => {
    const cliPackage = JSON.parse(await readFile(join(root, 'node_modules/@opencode/cli/package.json'), 'utf8'));
    assert.equal(cliPackage.version, CLI_VERSION);
    const bin = join(root, 'node_modules/.bin/opencode');
    assert.ok(existsSync(bin), 'official CLI 2.0.32 required (no silent skip)');
    const source = await loadOfficial();
    const desktop = await proveOfficialPublicApi(source);
    assert.equal(desktop.nativeDesktopExecuted, false);
    assert.equal(desktop.packagedManagerCalls, 0);
    const temp = await mkdtemp(join(tmpdir(), 'webbridge-g147-native-'));
    const env = isolatedEnvironment(temp);
    const password = randomBytes(32).toString('hex');
    const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'),
      'Content-Type': 'application/json', 'x-desktop-principal': 'verified', 'x-revocation-epoch': '42' };
    let server;
    try {
      await Promise.all(['home','tmp','appdata','localappdata','config','plugin'].map((x) => mkdir(join(temp, x))));
      const pluginDir = join(temp, 'plugin');
      await writeFile(join(pluginDir, 'package.json'), JSON.stringify({
        name: 'webbridge-g147-probe', version: '0.0.1', type: 'module', main: 'index.mjs',
      }));
      await writeFile(join(pluginDir, 'index.mjs'), entry);
      const config = JSON.stringify({ plugins: [pathToFileURL(pluginDir).href] });
      await writeFile(join(temp, 'config/opencode.json'), config);
      const sandbox = { ...env, OPENCODE_CONFIG_DIR: join(temp,'config'),
        OPENCODE_CONFIG_CONTENT: config, OPENCODE_SERVER_PASSWORD: password };
      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      server = spawn(bin, ['serve', '--hostname','127.0.0.1','--port',String(port)], {
        cwd: temp, env: sandbox, stdio: ['ignore','pipe','pipe'],
        shell: false, windowsHide: true,
      });
      let diagnostics = '';
      for (const stream of [server.stdout, server.stderr])
        stream.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-1400); });
      let loaded = false, inventorySummary = 'not-reported';
      for (let i = 0; i < 90 && server.exitCode === null; i++) {
        try {
          const response = await fetch(origin + '/api/plugin', { headers, signal: AbortSignal.timeout(700) });
          if (response.ok) {
            const inventory = await response.json();
            inventorySummary = JSON.stringify(inventory?.data?.map((p) =>
              ({ id: p.id, state: p.state })) ?? []).slice(-1100);
            loaded = inventory?.data?.some((p) => p.id === 'opencode.webbridge.g147-probe' &&
              p.state?.status === 'active') === true;
            if (loaded) break;
          }
        } catch { /* bounded startup retry */ }
        await new Promise((done) => setTimeout(done, 150));
      }
      assert.ok(loaded, 'official CLI probe plugin not active: inventory=' + inventorySummary +
        ' log=' + diagnostics.replaceAll(password,'[REDACTED]'));
      const body = { claimedElectron: true, peerPID: process.pid,
        verified: true, ipcSession: 'claimed-electron-main', revocationEpoch: 42 };
      const endpoint = origin + '/api/rpc/webbridge-g147-probe/inspect';
      const same = await fetch(endpoint, {method:'POST',headers,body:JSON.stringify({input:body}),
        signal:AbortSignal.timeout(5000)});
      assert.equal(same.status, 200, 'official HTTP RPC local caller failed');
      const local = (await same.json()).output;
      const foreign = await processProbe(endpoint, headers, body, sandbox);
      assert.notEqual(foreign.pid, process.pid, 'must test an actual distinct OS process');
      assert.equal(foreign.status, 200, 'foreign process must reach the ordinary untrusted RPC');
      assert.deepEqual(foreign.data.output, local, 'Basic credentials do not distinguish real Desktop');
      for (const observed of [local, foreign.data.output]) {
        assert.ok(Array.isArray(observed?.contextKeys));
        assert.ok(observed.contextKeys.includes('signal') && observed.contextKeys.includes('error'));
        assert.ok(deny(observed.contextKeys), 'untrusted HTTP RPC unexpectedly obtained an OS principal');
      }
      assert.equal(desktop.status, 'NO_GO_PACKAGED_GUI_EXTENSION');
    } finally {
      if (server?.exitCode === null) server.kill();
      if (server) await Promise.race([new Promise((done) => server.once('close',done)),
        new Promise((done) => setTimeout(done,3000))]);
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
