/** Smoke the actual OpenCode v2 plugin RPC endpoint with synthetic data only. */
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeOpenCodeExecutable } from '../dist/src/testing/native-cli-launcher.js';

async function freePort() {
  const srv = createServer();
  await new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', resolve); });
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

const tmp = await mkdtemp(join(tmpdir(), 'webbridge-rpc-fixture-'));
// Never persist the journal inside the OpenCode workspace watched for reloads.
const journalDir = await mkdtemp(join(tmpdir(), 'webbridge-rpc-journal-'));
const secret = randomBytes(32).toString('hex');
const password = randomBytes(32).toString('hex');
const binding = { sessionID: 'fixture-session', tabID: 'fixture-tab', providerID: 'qwen', accountRef: 'fixture-account' };
const port = await freePort();
let server;
let stderr = '';
let stdout = '';
try {
  const configDir = join(tmp, 'config');
  const pluginDir = join(tmp, 'plugin');
  await mkdir(configDir); await mkdir(pluginDir);
  await writeFile(join(pluginDir, 'package.json'), JSON.stringify({ name: 'webbridge-test-rpc-plugin',
    version: '0.0.0', type: 'module', main: 'index.mjs' }));
  await writeFile(join(pluginDir, 'index.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(resolve('dist/src/testing/native-rpc-relay-plugin.js')).href)};\n`);
  const config = JSON.stringify({ plugins: [pathToFileURL(pluginDir).href] });
  await writeFile(join(configDir, 'opencode.json'), config);

  const allowed = process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allowed.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
  Object.assign(env, {
    XDG_CONFIG_HOME: join(tmp, 'xdg-config'), XDG_DATA_HOME: join(tmp, 'xdg-data'),
    XDG_CACHE_HOME: join(tmp, 'xdg-cache'), XDG_STATE_HOME: join(tmp, 'xdg-state'),
    OPENCODE_CONFIG_DIR: configDir, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_CONFIG_CONTENT: config, WEBBRIDGE_RELAY_ENABLE: '1', WEBBRIDGE_RELAY_TOKEN: secret,
    WEBBRIDGE_RELAY_JOURNAL_DIR: journalDir,
    OPENCODE_SERVER_PASSWORD: password,
  });
  const exe = nativeOpenCodeExecutable();
  server = spawn(exe, ['serve', '--print-logs', '--log-level', 'debug', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    shell: process.platform === 'win32' && /\.cmd$/i.test(exe),
  });
  server.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-6000); });
  server.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-12000); });

  const url = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (server.exitCode !== null) break;
    try {
      const ping = await fetch(`${url}/api/plugin`, { headers, signal: AbortSignal.timeout(750) });
      if (ping.ok) { ready = true; break; }
    } catch { /* server not listening yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('isolated OpenCode RPC server did not start');

  async function rpc(method, input) {
    const response = await fetch(`${url}/api/rpc/webbridge-browser-fixture/${method}`, {
      method: 'POST', headers, body: JSON.stringify({ input: { ...binding, secret, ...input } }),
      signal: AbortSignal.timeout(5_000),
    }).catch((error) => { throw new Error(`RPC ${method}: ${String(error)}`); });
    const raw = await response.text();
    if (!response.ok) throw new Error(`RPC ${method} status ${response.status}: ${raw.slice(0,250)}`);
    return JSON.parse(raw).output;
  }

  const accepted = await rpc('submit', { turnID: 'turn-1', prompt: 'offline-only fixture prompt' });
  const invalid = await fetch(`${url}/api/rpc/webbridge-browser-fixture/take`, {
    method: 'POST', headers,
    body: JSON.stringify({ input: { ...binding, secret: '0'.repeat(64) } }),
    signal: AbortSignal.timeout(2500),
  });
  const invalidBody = await invalid.text();
  if (invalid.ok && !invalidBody.includes('unauthorized')) throw new Error('remote RPC accepted an invalid capability');
  const leased = await rpc('take', {});
  const second = await rpc('take', {});
  const completed = await rpc('complete', { turnID: 'turn-1', response: 'RPC_BROWSER_FIXTURE_OK' });
  const result = await rpc('result', { turnID: 'turn-1' });
  if (accepted.accepted !== true || leased.prompt !== 'offline-only fixture prompt' ||
      leased.turnID !== 'turn-1' || second.found !== false || completed.accepted !== true ||
      result.finished !== true || result.response !== 'RPC_BROWSER_FIXTURE_OK') {
    throw new Error('native RPC relay returned incorrect state');
  }
  const persisted = await readFile(join(journalDir, 'journal.json'), 'utf8');
  if (!persisted.includes('"phase":"settled"') || persisted.includes('offline-only fixture prompt') ||
      persisted.includes('RPC_BROWSER_FIXTURE_OK') || persisted.includes(secret)) {
    throw new Error('native RPC relay journal absent, leaked data or not settled');
  }
  console.log('G3 native OpenCode RPC relay: PASS (submit -> take once -> complete -> result)');
} catch (error) {
  const diag = `${stderr}\n${stdout}`.split(/\r?\n/)
    .filter((line) => /error|warn|journal|plugin|rpc|fail|lock/i.test(line)).slice(-14).join('\n');
  console.error(`G3 native RPC relay: FAIL — ${String(error).replaceAll(secret, '[REDACTED]')}\n${diag.slice(-2500).replaceAll(secret, '[REDACTED]').replaceAll(password, '[REDACTED]')}`);
  process.exitCode = 1;
} finally {
  if (server) {
    if (process.platform === 'win32' && server.pid) {
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else server.kill();
  }
  await rm(tmp, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  await rm(journalDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}
