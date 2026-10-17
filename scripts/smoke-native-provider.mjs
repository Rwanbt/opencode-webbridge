/** Manual G1 smoke: native OpenCode 2 session invokes our local fixture only. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { FIXTURE_MODEL, FIXTURE_REPLY, openFixtureServer } from '../dist/src/testing/fixture-inference.js';
import { FakeBrowserPort } from '../dist/src/testing/fake-browser.js';
import { browserFixtureResponder } from '../dist/src/testing/browser-fixture-relay.js';
import { nativeOpenCodeExecutable } from '../dist/src/testing/native-cli-launcher.js';

function run(binary, env, cwd) {
  return new Promise((resolvePromise, reject) => {
    const args = ['run', '--standalone', '--print-logs', '--log-level', 'debug', '--model', `webbridge-fixture/${FIXTURE_MODEL}`, '--format', 'json',
      'This is a local inference transport verification. Respond once.'];
    const child = spawn(binary, args, {
      cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32' && /\.cmd$/i.test(binary),
    });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    const collect = (target, chunk) => {
      const added = chunk.toString('utf8');
      if (target === 'stdout') stdout += added;
      else stderr += added;
      if (stdout.length + stderr.length > 200_000) { overflow = true; child.kill(); }
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', reject);
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({ code, stdout, stderr, overflow });
    });
  });
}

const temp = await mkdtemp(join(tmpdir(), 'webbridge-native-fixture-'));
const useBrowserFixture = process.argv.includes('--browser-fixture');
const fakeBinding = { sessionID: 'native-fixture', tabID: 'fake-tab', providerID: 'chatgpt', accountRef: 'fake-account' };
let forwarded = 0;
const browser = new FakeBrowserPort(() => { forwarded++; return FIXTURE_REPLY; });
if (useBrowserFixture) await browser.claim(fakeBinding);
const token = randomBytes(32).toString('hex');
const fixture = await openFixtureServer({
  token,
  ...(useBrowserFixture ? { respond: browserFixtureResponder(browser, fakeBinding) } : {}),
});
try {
  const configDir = join(temp, 'config');
  await mkdir(configDir);
  // OpenCode 2.0.29 currently rejects configured *files* even though the docs show
  // file examples: its loader logs "configured plugin path must be a directory".
  // A manifest-backed package directory is supported; keep this compatibility route.
  const pluginPath = resolve('dist/src/testing/native-fixture-plugin.js');
  const pluginDir = join(temp, 'fixture-plugin');
  await mkdir(pluginDir);
  await writeFile(join(pluginDir, 'package.json'), JSON.stringify({
    name: 'webbridge-private-fixture-plugin', version: '0.0.0', type: 'module', main: 'index.mjs',
  }));
  await writeFile(join(pluginDir, 'index.mjs'), `export { default } from ${JSON.stringify(pathToFileURL(pluginPath).href)};\n`);
  const productionDir = resolve('.');
  const config = JSON.stringify({ plugins: [pathToFileURL(productionDir).href, pathToFileURL(pluginDir).href] });
  await writeFile(join(configDir, 'opencode.json'), config);
  // An isolated profile avoids touching any normal OpenCode plugin, account, config or transcript.
  // In particular, do NOT pass inherited OPENAI_API_KEY, GITHUB_TOKEN, or any other credentials.
  const baseEnvKeys = process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'HOME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL'];
  const cleanEnv = Object.fromEntries(baseEnvKeys
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  const env = {
    ...cleanEnv,
    XDG_CONFIG_HOME: join(temp, 'xdg-config'),
    XDG_DATA_HOME: join(temp, 'xdg-data'),
    XDG_CACHE_HOME: join(temp, 'xdg-cache'),
    XDG_STATE_HOME: join(temp, 'xdg-state'),
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_CONFIG_CONTENT: config,
    WEBBRIDGE_FIXTURE_ENABLE: '1',
    WEBBRIDGE_FIXTURE_URL: fixture.baseURL,
    WEBBRIDGE_FIXTURE_TOKEN: token,
  };
  const binary = nativeOpenCodeExecutable();
  const result = await run(binary, env, temp);
  const responded = result.stdout.includes(FIXTURE_REPLY);
  const connected = fixture.requests() > 0 && (!useBrowserFixture || forwarded > 0);
  console.log(`OpenCode local fixture smoke: exit=${result.code}, HTTP requests=${fixture.requests()}, BrowserPort forwards=${forwarded}, reply-observed=${responded}`);
  if (result.code !== 0 || !responded || !connected || result.overflow) {
    // Restrict diagnostics to error metadata; never print account secrets or transcripts.
    const debug = result.stderr.split(/\r?\n/).filter((line) => /webbridge|plugin|config|provider|error|warn/i.test(line)).slice(-24).map((line) => line.slice(0,600));
    console.error(`Fixture native integration incomplete. Output tail: ${result.stdout.slice(-700)}\nRelevant diagnostics:\n${debug.join('\n')}`);
    process.exitCode = 1;
  }
} finally {
  await fixture.close();
  if (useBrowserFixture) await browser.release(fakeBinding);
  await rm(temp, { recursive: true, force: true, maxRetries: 12, retryDelay: 500 });
}
