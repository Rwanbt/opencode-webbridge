/** Real-package evidence for native WebBridge models through the official CLI.
 *
 * The RAW npm tarball of this repository is installed (no manual dist copy) into
 * a disposable OpenCode 2.0.32 profile, then the official CLI proves:
 *  1. dormant by default: no `webbridge-*` provider is registered without the
 *     individual activation list;
 *  2. individually activated: `webbridge-chatgpt/chatgpt-web` is selectable and a
 *     session turn is served by the plugin's LanguageModelV3 with exactly ONE
 *     browser turn (the core's auxiliary title call never reaches a browser);
 *  3. an unproven DOM terminal is recorded as an error finish, never a completion;
 *  4. with no attached authorized browser session the model refuses explicitly and
 *     never produces text (no simulated answer).
 *
 * The browser transport used here is an explicitly labeled, token-gated test
 * fixture; it is NOT a provider answer. Real authenticated sessions stay behind
 * explicit user consent. Runs where the official CLI binary is available
 * (Linux CI job, or `NATIVE_WEB_MODELS_CLI=1` locally).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, cp, copyFile, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PLUGIN_ID = 'opencode.webbridge';
const PROVIDER = 'webbridge-chatgpt';
const MODEL = 'chatgpt-web';
const FIXTURE_MARKER = 'WEBBRIDGE_FIXTURE_STREAM_OK';
const COMPLETION_RAW = 'webbridge-dom-completion-observed';
const TOKEN = 'b'.repeat(64);

const skip = process.env.NATIVE_WEB_MODELS_CLI !== '1';

/** Official CLI launcher: packaged binary on Windows, npm shim elsewhere. */
function launcher(): string {
  const packaged = join(ROOT, 'node_modules/@opencode/cli/bin/opencode.exe');
  if (process.platform === 'win32' && existsSync(packaged)) return packaged;
  return join(ROOT, 'node_modules/.bin/opencode');
}

/** npm is a `.cmd` shim on Windows: drive npm-cli.js through node instead. */
function npm(args: string[], timeout: number, cwd: string) {
  const cli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return process.platform === 'win32' && existsSync(cli)
    ? spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout })
    : spawnSync('npm', args, { cwd, encoding: 'utf8', timeout });
}

/** Real repository inputs for the packed artifact (sources + official prepack config). */
const PACK_INPUTS = ['src', 'scripts', 'bin', 'index.mjs', 'package.json', 'tsconfig.json',
  'tsconfig.pack.json', 'README.md', 'LICENSE', 'SECURITY.md', 'THIRD-PARTY-NOTICES.md'] as const;

/** Runs the REAL prepack + packs the repository into a raw archive, installed into
 *  a disposable profile. Staged in a temp copy with a linked node_modules so the
 *  official prepack runs (its own dist contract) without deleting the suite's
 *  compiled test files, and no compiled file is ever copied by hand. */
async function installRawPackage(temp: string): Promise<string> {
  const staged = join(temp, 'repo');
  await mkdir(staged, { recursive: true });
  for (const entry of PACK_INPUTS) {
    await cp(join(ROOT, entry), join(staged, entry), { recursive: true });
  }
  await symlink(join(ROOT, 'node_modules'), join(staged, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir');
  const pack = npm(['pack', '--json', '--pack-destination', temp], 240_000, staged);
  assert.equal(pack.status, 0, (pack.stderr ?? '').slice(-600));
  const archive = JSON.parse(pack.stdout)[0].filename;
  const profile = join(temp, 'profile');
  const install = npm(['install', join(temp, archive), '--prefix', profile, '--no-save',
    '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund'], 300_000, staged);
  assert.equal(install.status, 0, (install.stderr ?? '').slice(-600));
  return join(profile, 'node_modules/opencode-webbridge');
}

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

async function launch(temp: string, pluginDir: string, name: string,
  extraEnv: NodeJS.ProcessEnv): Promise<Launched> {
  const conf = join(temp, `config-${name}`);
  const home = join(temp, `home-${name}`);
  const data = join(temp, `data-${name}`);
  const cache = join(temp, `cache-${name}`);
  await Promise.all([mkdir(conf), mkdir(home), mkdir(data), mkdir(cache)]);
  const settings = JSON.stringify({ plugins: [pathToFileURL(pluginDir).href] });
  await writeFile(join(conf, 'opencode.json'), settings);
  const port = await freePort();
  const password = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: conf, XDG_DATA_HOME: data, XDG_CACHE_HOME: cache,
    OPENCODE_CONFIG_DIR: conf, OPENCODE_CONFIG_CONTENT: settings,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_SERVER_PASSWORD: password,
    WEBBRIDGE_NATIVE_MODEL_FIXTURE_LOG: join(temp, `fixture-${name}.log`),
    ...extraEnv,
  };
  const server = spawn(launcher(), ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let logs = '';
  for (const output of [server.stdout, server.stderr]) output?.on('data', (chunk: Buffer) => {
    logs = (logs + chunk.toString()).slice(-4000);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    env,
    headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') },
    logs: () => logs,
    alive: () => server.exitCode === null,
    close: () => { if (server.exitCode === null) server.kill(); },
  };
}

async function waitReady(launched: Launched, providerIDs: readonly string[],
  modelRefs: ReadonlyArray<{ providerID: string; modelID: string }> = []): Promise<{ providers: string; models: string }> {
  let providers = '';
  let models = '';
  for (let attempt = 0; attempt < 160 && launched.alive(); attempt++) {
    try {
      const plugin = await fetch(launched.url + '/api/plugin',
        { headers: launched.headers, signal: AbortSignal.timeout(700) });
      if (plugin.ok) {
        const active = (await plugin.json()).data.some((entry: any) =>
          entry.id === PLUGIN_ID && entry.state?.status === 'active');
        const providerRes = await fetch(launched.url + '/api/provider',
          { headers: launched.headers, signal: AbortSignal.timeout(700) });
        const modelRes = await fetch(launched.url + '/api/model',
          { headers: launched.headers, signal: AbortSignal.timeout(700) });
        if (providerRes.ok && modelRes.ok) {
          providers = JSON.stringify(await providerRes.json());
          models = JSON.stringify((await modelRes.json()).data ?? []);
          const present = active
            && providerIDs.every((id) => providers.includes(`"id":"${id}"`))
            && modelRefs.every((ref) => models.includes(`"providerID":"${ref.providerID}"`)
              && models.includes(`"modelID":"${ref.modelID}"`));
          if (present) return { providers, models };
        }
      }
    } catch { /* startup only; never a fake success */ }
    await new Promise<void>((done) => setTimeout(done, 150));
  }
  assert.fail(`plugin/provider/model absent from official CLI: ${providerIDs.join(',')} `
    + `providers=${providers.slice(0, 300)} models=${models.slice(0, 400)} logs=${launched.logs().slice(-300)}`);
}

function spawnRun(launched: Launched, model: string, prompt: string) {
  const child = spawn(launcher(),
    ['run', '--server', launched.url, '--model', model, '--format', 'json', prompt],
    { cwd: ROOT, env: launched.env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-100_000); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { child, finished, stdout: () => stdout, stderr: () => stderr };
}

/** Bounded session read: the latest session's messages, whatever the outcome. */
async function sessionJson(launched: Launched, predicate: RegExp, budgetMs: number): Promise<string> {
  let seen = '';
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      const sessions = await (await fetch(launched.url + '/api/session?limit=5',
        { headers: launched.headers, signal: AbortSignal.timeout(700) })).json();
      const id = sessions.data?.[0]?.id;
      if (id) {
        const messages = await (await fetch(launched.url + `/api/session/${id}/message?limit=10`,
          { headers: launched.headers, signal: AbortSignal.timeout(700) })).json();
        seen = JSON.stringify(messages);
        if (predicate.test(seen)) return seen;
      }
    } catch { /* keep polling inside the budget */ }
    await new Promise<void>((done) => setTimeout(done, 250));
  }
  return seen;
}

test('native web models: raw package registers no provider without individual activation', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'web-models-dormant-'));
  let launched: Launched | undefined;
  try {
    const pluginDir = await installRawPackage(temp);
    launched = await launch(temp, pluginDir, 'dormant', {});
    const ready = await waitReady(launched, []);
    assert.doesNotMatch(ready.providers, /webbridge-(chatgpt|deepseek|gemini|qwen|mistral)/,
      'a web provider was registered without the individual activation list');
    assert.doesNotMatch(ready.models, /"providerID":"webbridge-/,
      'a web model was registered without the individual activation list');
    const settings = await readFile(join(temp, 'config-dormant', 'opencode.json'), 'utf8');
    assert.match(settings, /plugins/, 'disposable profile never referenced the raw package');
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('native web models: activated provider serves one honest fixture turn through the CLI', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'web-models-turn-'));
  let launched: Launched | undefined;
  try {
    const pluginDir = await installRawPackage(temp);
    launched = await launch(temp, pluginDir, 'turn', {
      WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt',
      WEBBRIDGE_NATIVE_MODEL_FIXTURE: '1',
      WEBBRIDGE_NATIVE_MODEL_FIXTURE_TOKEN: TOKEN,
    });
    const ready = await waitReady(launched, [PROVIDER], [{ providerID: PROVIDER, modelID: MODEL }]);
    assert.match(ready.providers, /"name":"WebBridge ChatGPT Web \(personal browser session, no API key\)"/);
    const entry = JSON.parse(ready.models).find((model: any) =>
      model.providerID === PROVIDER && model.modelID === MODEL);
    assert.ok(entry, 'model entry missing from /api/model');
    assert.equal(entry.status, 'active');
    assert.equal(entry.enabled, true);
    assert.equal(entry.capabilities.tools, false, 'a browser session must not claim tool support');
    assert.match(entry.package, /native[\\/]provider-anchor\.js$/,
      'the anchor module is missing from the raw package');
    const run = spawnRun(launched, `${PROVIDER}/${MODEL}`, 'native web models cli prompt');
    const timer = setTimeout(() => run.child.kill(), 45_000);
    let exit: number | null;
    try { exit = await run.finished; } finally { clearTimeout(timer); }
    assert.equal(exit, 0, 'official CLI model failure: ' + run.stderr().slice(-350));
    assert.ok(run.stdout().includes('[WebBridge test fixture - NOT a provider answer]'),
      'the fixture text must stay explicitly labeled in the session output');
    assert.ok(run.stdout().includes(`${FIXTURE_MARKER} ${PROVIDER}/${MODEL}`),
      'plugin model text missing from the turn: ' + run.stdout().slice(-400));
    const log = (await readFile(join(temp, 'fixture-turn.log'), 'utf8')).trim().split('\n');
    assert.equal(log.length, 1,
      'exactly one browser turn expected (auxiliary calls must never reach a browser): ' + log.join(' | '));
    assert.match(log[0], /^fixture-turn:1:webbridge-chatgpt\/chatgpt-web:prompt-[a-f0-9]{16}:complete$/);
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('native web models: an unproven terminal is recorded as error, never as completion', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'web-models-uncertain-'));
  let launched: Launched | undefined;
  try {
    const pluginDir = await installRawPackage(temp);
    launched = await launch(temp, pluginDir, 'uncertain', {
      WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt',
      WEBBRIDGE_NATIVE_MODEL_FIXTURE: '1',
      WEBBRIDGE_NATIVE_MODEL_FIXTURE_TOKEN: TOKEN,
      WEBBRIDGE_NATIVE_MODEL_FIXTURE_STATE: 'uncertain',
    });
    await waitReady(launched, [PROVIDER], [{ providerID: PROVIDER, modelID: MODEL }]);
    const run = spawnRun(launched, `${PROVIDER}/${MODEL}`, 'native web models uncertain prompt');
    const recorded = await sessionJson(launched, new RegExp(FIXTURE_MARKER), 30_000);
    run.child.kill();
    await run.finished;
    assert.ok(recorded.includes(FIXTURE_MARKER), 'observed text was not preserved: ' + recorded.slice(-500));
    assert.doesNotMatch(recorded, new RegExp(COMPLETION_RAW),
      'an unproven terminal must never be recorded as a completion');
    assert.match(recorded, /"finish"\s*:\s*"error"|webbridge-terminal-uncertain/,
      'the session did not record an error terminal: ' + recorded.slice(-500));
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('native web models: without an attached session the model refuses and invents nothing', {
  skip,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'web-models-detached-'));
  let launched: Launched | undefined;
  try {
    const pluginDir = await installRawPackage(temp);
    launched = await launch(temp, pluginDir, 'detached', {
      WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt',
    });
    await waitReady(launched, [PROVIDER], [{ providerID: PROVIDER, modelID: MODEL }]);
    const run = spawnRun(launched, `${PROVIDER}/${MODEL}`, 'native web models detached prompt');
    const refusal = 'no attached authorized browser session';
    const recorded = await sessionJson(launched, new RegExp(refusal), 30_000);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && run.child.exitCode === null) {
      await new Promise<void>((done) => setTimeout(done, 250));
    }
    if (run.child.exitCode === null) run.child.kill();
    const exit = await run.finished;
    const evidence = `${recorded}\n${run.stdout()}\n${run.stderr()}`;
    assert.match(evidence, new RegExp(refusal), 'explicit refusal missing: ' + evidence.slice(-500));
    assert.notEqual(exit, 0, 'a detached session must never complete a turn successfully');
    assert.doesNotMatch(run.stdout(), new RegExp(FIXTURE_MARKER), 'no text may be invented without a session');
  } finally {
    launched?.close();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
