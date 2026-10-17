/** Full native model -> authenticated loopback -> OpenCode RPC -> fake companion -> answer. */
import { randomBytes } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openFixtureServer } from '../dist/src/testing/fixture-inference.js';
import { browserFixtureResponder } from '../dist/src/testing/browser-fixture-relay.js';
import { RpcBrowserFixturePort } from '../dist/src/testing/rpc-browser-port.js';
import { openLocalChatPage } from '../dist/src/testing/local-chat-page.js';
import { openLocalBrowserCompanion, submitLocalPageTurn } from '../dist/src/testing/local-browser-companion.js';

const useRealPage = process.argv.includes('--real-page');
const EXPECTED = useRealPage ? 'WEBBRIDGE_LOCAL_PAGE_OK:' : 'WEBBRIDGE_MODEL_RPC_END_TO_END_OK';
const binding = { sessionID: 'fixture-session', tabID: 'fixture-tab', providerID: 'qwen', accountRef: 'fixture-account' };
const secret = randomBytes(32).toString('hex');
const password = randomBytes(32).toString('hex');
const modelToken = randomBytes(32).toString('hex');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function executable() {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform !== 'win32') return 'opencode';
  const found = spawnSync('where.exe', ['opencode.cmd'], { encoding: 'utf8' });
  const path = found.stdout?.split(/\r?\n/).find((line) => line.toLowerCase().endsWith('opencode.cmd'));
  if (!path) throw new Error('OpenCode v2 launcher unavailable');
  return path.trim();
}

async function freePort() {
  const srv = createServer();
  await new Promise((ok, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', ok); });
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function launch(bin, args, cwd, env) {
  return spawn(bin, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && /\.cmd$/i.test(bin) });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let timeout;
  const closed = new Promise((resolve) => {
    child.once('close', resolve);
    timeout = setTimeout(resolve, 5_000);
  });
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else child.kill();
  await closed;
  clearTimeout(timeout);
}

const temp = await mkdtemp(join(tmpdir(), 'webbridge-g4-e2e-'));
const journalDir = await mkdtemp(join(tmpdir(), 'webbridge-g6-journal-'));
const port = await freePort();
const serverURL = `http://127.0.0.1:${port}`;
const headers = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
  'Content-Type': 'application/json' };
let server;
let runner;
let fake;
let localPage;
let browserCompanion;
let serverError = '';
let active = true;
let companionJobs = 0;
let sawPrompt = false;
let rpcCalls = 0;
let companionFailure;

async function rpc(method, payload) {
  rpcCalls++;
  const response = await fetch(`${serverURL}/api/rpc/webbridge-browser-fixture/${method}`, {
    method: 'POST', headers, body: JSON.stringify({ input: { ...binding, secret, ...payload } }),
    signal: AbortSignal.timeout(4_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`relay ${method} returned HTTP ${response.status}`);
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed.output !== 'object') throw new Error('malformed RPC response');
  return parsed.output;
}

try {
  const pluginModel = join(temp, 'model-plugin');
  const pluginRPC = join(temp, 'rpc-plugin');
  const configDir = join(temp, 'config');
  await Promise.all([mkdir(pluginModel), mkdir(pluginRPC), mkdir(configDir)]);
  const pack = async (directory, name, module) => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '0.0.0',
      type: 'module', main: 'index.mjs' }));
    await writeFile(join(directory, 'index.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(resolve(module)).href)};\n`);
  };
  await pack(pluginModel, 'webbridge-g4-model-fixture', 'dist/src/testing/native-fixture-plugin.js');
  await pack(pluginRPC, 'webbridge-g4-rpc-fixture', 'dist/src/testing/native-rpc-relay-plugin.js');
  // Register the short-lived RPC handler before the provider transform.
  const config = JSON.stringify({ plugins: [pathToFileURL(pluginRPC).href, pathToFileURL(pluginModel).href] });
  await writeFile(join(configDir, 'opencode.json'), config);

  const allow = process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allow.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
    XDG_CACHE_HOME: join(temp, 'xdg-cache'), XDG_STATE_HOME: join(temp, 'xdg-state'),
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_CONFIG_CONTENT: config, OPENCODE_SERVER_PASSWORD: password,
    WEBBRIDGE_RELAY_ENABLE: '1', WEBBRIDGE_RELAY_TOKEN: secret,
    WEBBRIDGE_RELAY_JOURNAL_DIR: journalDir,
    WEBBRIDGE_FIXTURE_ENABLE: '1', WEBBRIDGE_FIXTURE_TOKEN: modelToken,
  });

  const portAdapter = new RpcBrowserFixturePort(binding, rpc);
  await portAdapter.claim(binding);
  fake = await openFixtureServer({ token: modelToken, respond: browserFixtureResponder(portAdapter, binding) });
  env.WEBBRIDGE_FIXTURE_URL = fake.baseURL;
  const bin = executable();
  server = launch(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], temp, env);
  server.stderr.on('data', (chunk) => { serverError = (serverError + chunk.toString('utf8')).slice(-4000); });
  server.stdout.on('data', () => {});

  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(`${serverURL}/api/plugin`, { headers, signal: AbortSignal.timeout(700) });
      if (response.ok) { ready = true; break; }
    } catch { /* starting */ }
    await delay(200);
  }
  if (!ready) throw new Error('isolated OpenCode server startup failed');
  if (useRealPage) {
    localPage = await openLocalChatPage();
    browserCompanion = await openLocalBrowserCompanion();
    await assert.rejects(
      submitLocalPageTurn(browserCompanion.page, 'https://example.com/', 'refuse external pages'),
      /only explicit local test page URLs/,
    );
    await assert.rejects(
      submitLocalPageTurn(browserCompanion.page, new URL('/admin', localPage.url).href, 'refuse other paths'),
      /only explicit local test page URLs/,
    );
  }

  const companion = (async () => {
    while (active) {
      const next = await rpc('take', {});
      if (!next.found) { await delay(80); continue; }
      companionJobs++;
      if (typeof next.prompt !== 'string') throw new Error('companion got invalid prompt');
      if (next.prompt.includes('WEBBRIDGE_G4_QUESTION')) sawPrompt = true;
      const answer = useRealPage
        ? await submitLocalPageTurn(browserCompanion.page, localPage.url, next.prompt)
        : EXPECTED;
      if (useRealPage && !answer.includes('WEBBRIDGE_G4_QUESTION')) {
        throw new Error('browser page did not echo the submitted prompt');
      }
      // Deterministic progressive companion: no resend and no guessed terminal.
      // A real commercial site is never opened; only local fake pages are used.
      const midpoint = Math.floor(answer.length / 2);
      const first = await rpc('progress', { turnID: next.turnID, seq: 1, value: answer.slice(0, midpoint) });
      if (first.accepted !== true) throw new Error('progress chunk rejected');
      const second = await rpc('progress', { turnID: next.turnID, seq: 2, value: answer.slice(midpoint) });
      if (second.accepted !== true) throw new Error('second progress chunk rejected');
      const done = await rpc('complete', { turnID: next.turnID, response: answer });
      if (done.accepted !== true) throw new Error('companion completion rejected');
    }
  })().catch((error) => { companionFailure = error; active = false; });
  let output = '';
  const runnerResult = new Promise((resolvePromise, reject) => {
    runner = launch(bin, ['run', '--server', serverURL, '--model',
      'webbridge-fixture/webbridge-native-fixture', '--format', 'json',
      'WEBBRIDGE_G4_QUESTION: answer from the local fake companion, no tools.'], temp, env);
    runner.stdout.on('data', (chunk) => { output = (output + chunk.toString('utf8')).slice(-40_000); });
    runner.stderr.on('data', (chunk) => { serverError = (serverError + chunk.toString('utf8')).slice(-4000); });
    runner.once('error', reject);
    runner.once('close', (exit) => resolvePromise(exit));
  });
  let timeout;
  const result = await Promise.race([
    runnerResult,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('native run timed out')), 45_000); }),
  ]).finally(() => clearTimeout(timeout));
  active = false;
  await companion;
  await portAdapter.release(binding);
  if (companionFailure) throw companionFailure;
  if (result !== 0 || !output.includes(EXPECTED) || companionJobs < 1 || !sawPrompt || fake.requests() < 1) {
    throw new Error(`native session or relay incomplete: exit=${result}; jobs=${companionJobs}; receivedPrompt=${sawPrompt}; HTTP=${fake.requests()}`);
  }
  console.log(`G4 native model-to-RPC-to-${useRealPage ? 'real-local-browser' : 'fake-companion'} E2E PASS: HTTP=${fake.requests()}, companionJobs=${companionJobs}, RPC=${rpcCalls}, response=true`);
} catch (error) {
  process.exitCode = 1;
  const safe = String(error).replaceAll(secret, '[REDACTED]').replaceAll(password, '[REDACTED]').replaceAll(modelToken, '[REDACTED]');
  console.error(`G4 native E2E FAILED: ${safe}; diagnostic=${serverError.slice(-550).replaceAll(secret, '[REDACTED]')}`);
} finally {
  active = false;
  await stop(runner);
  await stop(server);
  if (fake) await fake.close();
  if (browserCompanion) await browserCompanion.close();
  if (localPage) await localPage.close();
  await rm(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
  await rm(journalDir, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
}
