/** Executable evidence for the native model surface a WebBridge provider needs.
 *
 * GREEN: a plugin anchor module (`package: 'aisdk:file://…'` + `create*` export,
 * loaded by the core) and a promise-API `aisdk.hook('language')` serve a real
 * LanguageModelV3 through the official CLI 2.0.32. The turn completes once with
 * the plugin-supplied model text and the session records `finish: "stop"`.
 *
 * RED: `finishReason.unified === 'other'` is normalized to "unknown" by the
 * session layer and refused as an incomplete stream; there is no accepted
 * first-class UNCERTAIN terminal. See
 * docs/proposals/plugin-provided-language-model.fr.md.
 *
 * Linux-only: the official CLI launcher is spawned from node_modules/.bin.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROVIDER = 'webbridge-native-module-test';
const MODEL = 'webbridge-module-fixture';
const PLUGIN_ID = 'opencode.webbridge.native-module-test';
const GREEN_TEXT = 'NATIVE_MODULE_PROVIDER_STREAM_OK';

/** Green only under the dedicated Linux CI job; never silently skipped elsewhere. */
const skip = process.platform !== 'linux' || process.env.NATIVE_PROVIDER_MODULE_CLI !== '1';

const tokenUsage = '{ inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, '
  + 'outputTokens: { total: 2, text: 2, reasoning: 0 } }';

/** Anchor package resolved by the core loader from a file:// URL. */
const anchorModule = String.raw`
import { appendFileSync } from 'node:fs';
const finish = process.env.WEBBRIDGE_MODULE_FIXTURE_FINISH === 'other' ? 'other' : 'stop';
const logPath = process.env.WEBBRIDGE_MODULE_FIXTURE_LOG;
const log = (event) => { if (logPath) appendFileSync(logPath, event + '\n'); };
const usage = ${tokenUsage};
const model = {
  specificationVersion: 'v3',
  provider: '${PROVIDER}',
  modelId: '${MODEL}',
  supportedUrls: {},
  async doGenerate() {
    log('module-doGenerate');
    return {
      content: [{ type: 'text', text: 'NATIVE_MODULE_PROVIDER_UNARY' }],
      finishReason: { unified: finish, raw: 'webbridge-module-fixture' },
      usage,
      warnings: [],
    };
  },
  async doStream() {
    log('module-doStream');
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: 'module-text' });
        controller.enqueue({ type: 'text-delta', id: 'module-text', delta: '${GREEN_TEXT}' });
        controller.enqueue({ type: 'text-end', id: 'module-text' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: finish, raw: 'webbridge-module-fixture' },
          usage,
        });
        controller.close();
      },
    });
    return { stream };
  },
};
export function createWebBridgeModuleFixture(options) {
  log('anchor-create:' + JSON.stringify(options ?? null));
  return { languageModel: () => model };
}
`;

/** External plugin: provider registration + in-process LanguageModelV3 hook. */
const pluginEntry = String.raw`
import { Model, Plugin, Provider } from '@opencode/plugin';
const providerID = Provider.ID.make('${PROVIDER}');
const finish = process.env.WEBBRIDGE_MODULE_FIXTURE_FINISH === 'other' ? 'other' : 'stop';
const usage = ${tokenUsage};
const hooked = {
  specificationVersion: 'v3',
  provider: '${PROVIDER}',
  modelId: '${MODEL}',
  supportedUrls: {},
  async doGenerate() {
    return {
      content: [{ type: 'text', text: 'NATIVE_MODULE_PROVIDER_UNARY' }],
      finishReason: { unified: finish, raw: 'webbridge-module-fixture' },
      usage,
      warnings: [],
    };
  },
  async doStream() {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        controller.enqueue({ type: 'text-start', id: 'hooked-text' });
        controller.enqueue({ type: 'text-delta', id: 'hooked-text', delta: '${GREEN_TEXT}' });
        controller.enqueue({ type: 'text-end', id: 'hooked-text' });
        controller.enqueue({
          type: 'finish',
          finishReason: { unified: finish, raw: 'webbridge-module-fixture' },
          usage,
        });
        controller.close();
      },
    });
    return { stream };
  },
};
export default Plugin.define({
  id: '${PLUGIN_ID}',
  async setup(ctx) {
    const languageHook = await ctx.aisdk.hook('language', (input) => {
      if (input.model?.providerID === '${PROVIDER}') input.language = hooked;
    });
    const registration = await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: 'WebBridge native module fixture (NOT a commercial provider)',
          activation: 'enabled',
          package: 'aisdk:' + new URL('./provider.mjs', import.meta.url).href,
          settings: {},
        },
        models: [{
          ...Model.Info.default(providerID, Model.ID.make('${MODEL}')),
          name: 'WebBridge native module fixture',
          capabilities: { tools: false, input: ['text'], output: ['text'] },
        }],
      });
    });
    return async () => { await languageHook.dispose(); await registration.dispose(); };
  },
});
`;

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

interface Launched {
  readonly url: string;
  readonly env: NodeJS.ProcessEnv;
  readonly headers: Record<string, string>;
  readonly logs: () => string;
  readonly alive: () => boolean;
  readonly close: () => void;
}

/** Installs the staged package into a disposable profile; no manual dist copy. */
async function stagePlugin(temp: string): Promise<string> {
  const stage = join(temp, 'package');
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, 'provider.mjs'), anchorModule);
  await writeFile(join(stage, 'index.mjs'), pluginEntry);
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: 'webbridge-native-module-test', version: '0.0.1', type: 'module', main: 'index.mjs',
    files: ['index.mjs', 'provider.mjs'],
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
  return join(profile, 'node_modules/webbridge-native-module-test');
}

async function launch(temp: string, moduleDir: string, name: string, finish?: 'other'): Promise<Launched> {
  const conf = join(temp, `config-${name}`);
  const home = join(temp, `home-${name}`);
  const data = join(temp, `data-${name}`);
  const cache = join(temp, `cache-${name}`);
  await Promise.all([mkdir(conf), mkdir(home), mkdir(data), mkdir(cache)]);
  const settings = JSON.stringify({ plugins: [pathToFileURL(moduleDir).href] });
  await writeFile(join(conf, 'opencode.json'), settings);
  const port = await freePort();
  const password = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: conf, XDG_DATA_HOME: data, XDG_CACHE_HOME: cache,
    OPENCODE_CONFIG_DIR: conf, OPENCODE_CONFIG_CONTENT: settings,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_SERVER_PASSWORD: password,
    WEBBRIDGE_MODULE_FIXTURE_LOG: join(temp, `fixture-${name}.log`),
    ...(finish === 'other' ? { WEBBRIDGE_MODULE_FIXTURE_FINISH: 'other' } : {}),
  };
  const server = spawn(join(process.cwd(), 'node_modules/.bin/opencode'),
    ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let logs = '';
  for (const output of [server.stdout, server.stderr]) output?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  const url = `http://127.0.0.1:${port}`;
  const auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
  return {
    url, env, headers: { Authorization: auth }, logs: () => logs,
    alive: () => server.exitCode === null,
    close: () => { if (server.exitCode === null) server.kill(); },
  };
}

/** Waits for the official CLI to load and activate our external plugin. */
async function waitReady(launched: Launched): Promise<void> {
  for (let attempt = 0; attempt < 120 && launched.alive(); attempt++) {
    try {
      const plugin = await fetch(launched.url + '/api/plugin',
        { headers: launched.headers, signal: AbortSignal.timeout(700) });
      if (plugin.ok) {
        const active = (await plugin.json()).data.some((entry: any) =>
          entry.id === PLUGIN_ID && entry.state?.status === 'active');
        const providers = await fetch(launched.url + '/api/provider',
          { headers: launched.headers, signal: AbortSignal.timeout(700) });
        if (providers.ok) {
          const inventory = JSON.stringify(await providers.json());
          assert.doesNotMatch(inventory, /webbridge-(chatgpt|gemini|deepseek|qwen|mistral)/);
          assert.ok(inventory.includes(PROVIDER), 'provider registration missing from inventory');
          if (active) return;
        }
      }
    } catch { /* only startup; no fake model success */ }
    await new Promise<void>((done) => setTimeout(done, 150));
  }
  assert.fail('plugin absent from official CLI: ' + launched.logs().slice(-500));
}

function spawnRun(launched: Launched, prompt: string) {
  const child = spawn(join(process.cwd(), 'node_modules/.bin/opencode'),
    ['run', '--server', launched.url, '--model', `${PROVIDER}/${MODEL}`, '--format', 'json', prompt],
    { cwd: process.cwd(), env: launched.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-100_000); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { child, finished, stdout: () => stdout, stderr: () => stderr };
}

test('native provider module: official CLI loads the plugin anchor and streams its LanguageModelV3', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'native-provider-module-'));
  let launched: Launched | undefined;
  try {
    const moduleDir = await stagePlugin(temp);
    launched = await launch(temp, moduleDir, 'green');
    await waitReady(launched);
    const run = spawnRun(launched, 'NATIVE_MODULE_PROVIDER_PROMPT');
    const timer = setTimeout(() => run.child.kill(), 45_000);
    let exit: number | null;
    try { exit = await run.finished; } finally { clearTimeout(timer); }
    assert.equal(exit, 0, 'official CLI model failure: ' + run.stderr().slice(-350));
    assert.ok(run.stdout().includes(GREEN_TEXT), 'plugin-supplied model text missing from the turn');
    const log = await readFile(join(temp, 'fixture-green.log'), 'utf8');
    assert.match(log, /anchor-create:/, 'core never loaded the plugin anchor module');
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('native provider module: an uncertain "other" finish reason is refused as incomplete', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'native-provider-uncertain-'));
  let launched: Launched | undefined;
  try {
    const moduleDir = await stagePlugin(temp);
    launched = await launch(temp, moduleDir, 'red', 'other');
    await waitReady(launched);
    const run = spawnRun(launched, 'NATIVE_MODULE_UNCERTAIN_PROMPT');
    let recorded = false;
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      try {
        const sessions = await (await fetch(launched.url + '/api/session?limit=5',
          { headers: launched.headers, signal: AbortSignal.timeout(700) })).json();
        const id = sessions.data?.[0]?.id;
        if (id) {
          const messages = await (await fetch(launched.url + `/api/session/${id}/message?limit=10`,
            { headers: launched.headers, signal: AbortSignal.timeout(700) })).json();
          if (/unknown finish reason/i.test(JSON.stringify(messages))) { recorded = true; break; }
        }
      } catch { /* keep polling until the bounded deadline */ }
      await new Promise<void>((done) => setTimeout(done, 250));
    }
    run.child.kill();
    const exit = await run.finished;
    assert.ok(recorded, 'session did not record the incomplete-stream refusal');
    assert.notEqual(exit, 0, 'an uncertain terminal must never complete a turn successfully');
    const log = await readFile(join(temp, 'fixture-red.log'), 'utf8');
    assert.match(log, /anchor-create:/, 'core never loaded the plugin anchor module');
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
