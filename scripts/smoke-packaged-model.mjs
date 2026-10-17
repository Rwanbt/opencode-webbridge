/** Native CLI fake-model turn must use the G81 RPC package actually installed from .tgz. */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exerciseRPCPackage } from './offline-rpc-package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
const dist = join(root, 'dist/src/testing');
const marker = 'G88_PACKAGED_RPC_MODEL_PROOF';
const prompt = 'G88_REMOTE_MODEL_PROMPT: offline model via installed local RPC, no tools.';
export function receiptText(secret, nonce) {
  if (!/^[a-f0-9]{64}$/.test(secret) || !/^[a-z0-9_-]{8,48}$/.test(nonce)) {
    throw new Error('invalid local receipt input');
  }
  return marker + '_' + createHmac('sha256', secret).update(nonce).digest('hex').slice(0, 24) + '_OK';
}
function runCLI(executable, args, env, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.cmd$/i.test(executable) });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    child.stdout.on('data', (data) => {
      stdout += data.toString('utf8');
      if (stdout.length > 120_000) { overflow = true; child.kill(); }
    });
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString('utf8')).slice(-1000); });
    const timer = setTimeout(() => child.kill(), 50_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr, overflow }); });
  });
}

export function createModelBridge({ directoryModel = true } = {}) { return {
  async prepare({ temp, version }) {
    const modelDist = join(dist, 'native-fixture-plugin.js');
    if (directoryModel && !existsSync(modelDist)) throw new Error('build local fixture first; never rebuild OpenCode');
    const { openFixtureServer } = await import(pathToFileURL(join(dist, 'fixture-inference.js')).href);
    let modelPluginDir;
    if (directoryModel) {
      modelPluginDir = join(temp, 'model-g88-' + version.replaceAll('.', '-'));
      await mkdir(modelPluginDir);
      await writeFile(join(modelPluginDir, 'package.json'), JSON.stringify({
        name: 'g88-local-model-fixture', type: 'module', version: '0.0.0', main: 'index.mjs',
      }));
      await writeFile(join(modelPluginDir, 'index.mjs'),
        'export { default } from ' + JSON.stringify(pathToFileURL(modelDist).href) + ';\n');
    }
    const modelToken = randomBytes(32).toString('hex');
    let rpcConnection;
    let requests = 0;
    let expected = '';
    let rpcCalls = 0;
    let authorizedResult;
    const fake = await openFixtureServer({
      token: modelToken,
      respond: async (messages) => {
        if (!JSON.stringify(messages).includes(prompt) || !rpcConnection || ++requests > 12) {
          throw new Error('invalid or unbounded fake model request');
        }
        // OpenCode may make more than one completion request in a native turn.
        // Cache only the FIRST authenticated receipt; never replay the native RPC.
        authorizedResult ??= (async () => {
          const nonce = 'g88_nonce_' + version.replaceAll('.', '_') + '_' + randomBytes(4).toString('hex');
          rpcCalls++;
          const reply = await fetch(rpcConnection.url + '/api/rpc/webbridge-g81-package/challenge', {
            method: 'POST', headers: rpcConnection.headers,
            body: JSON.stringify({ input: {
              secret: rpcConnection.secret, scope: 'g81-local-profile', nonce,
            } }), signal: AbortSignal.timeout(4000),
          });
          if (!reply.ok) throw new Error('installed native RPC refused model fixture request');
          const result = await reply.json();
          const digest = createHmac('sha256', rpcConnection.secret).update(nonce).digest('hex');
          if (result?.output?.receipt !== digest) throw new Error('native RPC HMAC mismatch');
          return receiptText(rpcConnection.secret, nonce);
        })();
        expected = await authorizedResult;
        const mid = Math.floor(expected.length / 2);
        return (async function* () {
          yield expected.slice(0, mid);
          await new Promise((done) => setTimeout(done, 40));
          yield expected.slice(mid);
        })();
      },
    });
    assert.match(fake.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    return {
      modelPluginDir,
      env: { WEBBRIDGE_FIXTURE_ENABLE: '1', WEBBRIDGE_FIXTURE_TOKEN: modelToken,
        WEBBRIDGE_FIXTURE_URL: fake.baseURL },
      async verify({ url, headers, secret, executable, env, temp }) {
        rpcConnection = { url, headers, secret };
        if (!directoryModel) {
          const listed = await fetch(url + '/api/plugin', {
            headers, signal: AbortSignal.timeout(2_000) });
          if (!listed.ok) throw new Error('native plugin inventory missing');
          const entries = (await listed.json()).data;
          if (!Array.isArray(entries) ||
            !entries.some((x) => x.id === 'opencode.webbridge.g97-combined-test' && x.state?.status === 'active') ||
            entries.some((x) => x.id === 'opencode.webbridge.fixture' || x.id === 'opencode.webbridge.rpc-package-fixture')) {
            throw new Error('native provider provenance not exclusively the combined tarball');
          }
        }
        const run = await runCLI(executable, ['run', '--server', url, '--model',
          'webbridge-fixture/webbridge-native-fixture', '--format', 'json', prompt], env, temp);
        if (run.code !== 0 || run.overflow || rpcCalls !== 1 || requests < 1 || requests > 12 ||
          fake.requests() < 1 || fake.requests() > 12 ||
          fake.streamFrames() < 2 || !expected || !run.stdout.includes(expected)) {
          throw new Error('CLI model-to-packaged-RPC proof failed: exit=' + run.code +
            ', requests=' + requests + ', RPC=' + rpcCalls + ', HTTP=' + fake.requests() + ', SSE=' +
            fake.streamFrames() + ', output=' + run.stdout.includes(expected) +
            ', resultTail=' + run.stdout.slice(-300).replaceAll(secret, '[REDACTED]') +
            ', stderrTail=' + run.stderr.slice(-300).replaceAll(secret, '[REDACTED]'));
        }
        return { nativeModel: true, packagedRpcUsed: true, fixtureHTTP: fake.requests(),
          sseFrames: fake.streamFrames(), selectedModel: 'webbridge-fixture/webbridge-native-fixture' };
      },
      close: () => fake.close(),
    };
  },
}; }
export const modelBridge = createModelBridge();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(cli)) throw new Error('pinned repository-local OpenCode 2.0.29 CLI required');
  exerciseRPCPackage({ nativeBin: cli, modelBridge }).then((result) => {
    assert.equal(result.nativeChecks.length, 2);
    for (const check of result.nativeChecks) {
      assert.equal(check.model?.packagedRpcUsed, true);
      assert.ok(check.model.sseFrames >= 2);
    }
    console.log('G88 installed RPC -> CLI model/SSE PASS', JSON.stringify(result));
  }).catch((error) => {
    console.error('G88 installed RPC -> CLI model/SSE FAIL:', error.message);
    process.exitCode = 1;
  });
}
