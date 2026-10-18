import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, cp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import root from '../src/index.js';
import { g163ReadConfig, registerG163PersonalRead } from '../src/runtime/g163-root-read.js';

const env = (port = 9222) => ({
  WEBBRIDGE_PERSONAL_CDP_READONLY: '1',
  WEBBRIDGE_PERSONAL_BROWSER_OWNED: '1',
  WEBBRIDGE_PERSONAL_CDP_ENDPOINT: `http://127.0.0.1:${port}`,
});
function fakeContext() {
  let installed: any, disposed = 0, allowed = true;
  const actions: string[] = [];
  const ctx: any = {
    tool: { transform: async (register: (editor: any) => void) => {
      register({ add: (value: unknown) => { installed = value; } });
      return { dispose: async () => { disposed++; } };
    } },
    permission: { assert: async ({ action }: { action: string }) => {
      actions.push(action);
      if (!allowed) throw new Error('operator denied');
    } },
  };
  const invoke = (input: unknown) => installed.execute(input, {
    sessionID: 'ses_g163_test', agent: 'agent', messageID: 'msg',
    id: 'call', signal: new AbortController().signal,
  });
  return { ctx, invoke, actions, installed: () => installed,
    deny: () => { allowed = false; }, disposed: () => disposed };
}

test('G163 inactive root remains inert; hostile opt-in and non-loopback endpoints refused', async () => {
  const previous = { ...process.env };
  try {
    delete process.env.WEBBRIDGE_G150_LOCAL_FIXTURE;
    delete process.env.WEBBRIDGE_PERSONAL_CDP_READONLY;
    const host = fakeContext();
    await root.setup(host.ctx);
    assert.equal(host.installed(), undefined);
    assert.equal(g163ReadConfig({}), null);
    for (const change of [
      { WEBBRIDGE_PERSONAL_BROWSER_OWNED: '0' },
      { WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://localhost:9222' },
      { WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://127.0.0.1:9222/?secret=yes' },
      { WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://127.0.0.1:9222@evil.example' },
      { WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'https://127.0.0.1:9222' },
    ]) assert.throws(() => g163ReadConfig({ ...env(), ...change }), /refused/);
    process.env = { ...previous, ...env() };
    const cleanup = await root.setup(host.ctx);
    assert.equal(host.installed().name, 'webbridge_browser');
    assert.equal(typeof host.installed().execute, 'function');
    assert.ok(cleanup);
    await cleanup!();
    assert.equal(host.disposed(), 1);
  } finally { process.env = previous; }
});

test('G163 read requires explicit provider+tab, never opens CDP without both', async () => {
  const host = fakeContext();
  await registerG163PersonalRead(host.ctx, env());
  await assert.rejects(host.invoke({ action: 'read', provider: 'qwen', tabID: '' }), /explicit/);
  await assert.rejects(host.invoke({ action: 'read', provider: 'evil', tabID: 'ABCD' }), /explicit/);
  await assert.rejects(host.invoke({ action: 'read', provider: 'qwen', tabID: 'ABCD' }), /unverified/);
  await assert.rejects(host.invoke({ action: 'observe', provider: 'qwen', tabID: 'ABCD',
    messageKey: 'answer-1' }), /unverified/);
  assert.equal(host.actions.length, 0);
});

async function reservePort() {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('G163 real root registration -> owned Chromium CDP five origins -> ChatGPT read with per-operation permission', {
  skip: process.platform !== 'linux' || process.env.G163_REAL_CDP !== '1',
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'g163-real-root-'));
  const port = await reservePort();
  let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      headless: true, args: [`--remote-debugging-port=${port}`, '--no-first-run'],
      serviceWorkers: 'block', acceptDownloads: false,
    });
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.route('https://chatgpt.com/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<h1>Session ready</h1><article data-turn="assistant" data-turn-id="answer-1"><div class="markdown">Real local root read</div></article>' +
        '<input type="password" value="PRIVATE_CREDENTIAL"/><div data-turn="user">PRIVATE_PROMPT</div>',
    }));
    await page.goto('https://chatgpt.com/c/local-only', { waitUntil: 'domcontentloaded' });
    const host = fakeContext();
    await registerG163PersonalRead(host.ctx, env(port));
    const listed = await host.invoke({ action: 'list' });
    const tabs = JSON.parse(listed.content) as { tabID: string; provider: string }[];
    const tab = tabs.find((t) => t.provider === 'chatgpt');
    assert.ok(tab, 'actual user-owned CDP tab must be discovered');
    assert.equal(listed.metadata.inferenceEnabled, false);
    assert.doesNotMatch(listed.content, /\/c\/local-only|PRIVATE_/);
    const headings = await host.invoke({ action: 'headings', provider: 'chatgpt', tabID: tab.tabID });
    assert.deepEqual(JSON.parse(headings.content), ['Session ready']);
    const read = await host.invoke({ action: 'read', provider: 'chatgpt', tabID: tab.tabID });
    assert.equal(read.content, 'Real local root read');
    assert.doesNotMatch(JSON.stringify(read), /PRIVATE_CREDENTIAL|PRIVATE_PROMPT/);
    const progress = await host.invoke({ action: 'observe', provider: 'chatgpt',
      tabID: tab.tabID, messageKey: 'answer-1', polls: 2 });
    const fragments = JSON.parse(progress.content) as { seq: number; value: string }[];
    assert.equal(fragments.map((piece) => piece.value).join(''), 'Real local root read');
    assert.equal(progress.metadata.completionVerified, false);
    assert.doesNotMatch(JSON.stringify(progress), /PRIVATE_CREDENTIAL|PRIVATE_PROMPT/);
    assert.ok(host.actions.includes('webbridge.cdp.attach'));
    assert.ok(host.actions.includes('webbridge.cdp.assistant.read'));
    assert.equal(await page.locator('.markdown').textContent(), 'Real local root read');
    await page.route('https://chat.qwen.ai/**', (route) => route.fulfill({
      status: 200, contentType: 'text/html', body: '<h1>Qwen local metadata only</h1>',
    }));
    await page.goto('https://chat.qwen.ai/c/intercepted', { waitUntil: 'domcontentloaded' });
    const qwenList = await host.invoke({ action: 'list' });
    const qwenTab = (JSON.parse(qwenList.content) as { provider: string; tabID: string }[])
      .find((item) => item.provider === 'qwen');
    assert.ok(qwenTab);
    const probe = await host.invoke({ action: 'probe', provider: 'qwen', tabID: qwenTab.tabID });
    assert.equal(JSON.parse(probe.content).readStatus, 'NO_GO_UNVERIFIED_LIVE_QWEN_DOM');
    assert.equal(probe.metadata.inferenceEnabled, false);
    await assert.rejects(host.invoke({ action: 'read', provider: 'qwen', tabID: qwenTab.tabID }),
      /unverified/);
    host.deny();
    await assert.rejects(host.invoke({ action: 'probe', provider: 'qwen', tabID: qwenTab.tabID }),
      /denied/);
  } finally {
    await browser?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('G163 actual npm-packed ROOT loads opt-in tool through official CLI 2.0.32, no model advertised', {
  skip: process.platform !== 'linux' || process.env.G163_NATIVE_ROOT !== '1',
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'g163-actual-'));
  const cli = join(process.cwd(), 'node_modules/.bin/opencode');
  const invokeNpm = (args: string[]) => {
    const out = spawnSync('npm', args, {
      cwd: process.cwd(), encoding: 'utf8', timeout: 100_000,
      env: { ...process.env, npm_config_audit: 'false' }, maxBuffer: 400_000,
    });
    assert.equal(out.status, 0, 'isolated npm pack/install failed: ' + (out.stderr ?? '').slice(-240));
    return out.stdout;
  };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    // npm ignores the repository's dist/ directory. Stage the EXACT emitted
    // root module tree, not a synthetic G97 plugin or freshly authored stub.
    const staging = join(temp, 'real-root');
    await mkdir(join(staging, 'dist'), { recursive: true });
    await cp(join(process.cwd(), 'dist/src'), join(staging, 'dist/src'), { recursive: true });
    // OpenCode native loader's proven packaged plugin contract uses index.mjs;
    // this wrapper ONLY re-exports the actual unmodified compiled src/index.js.
    await writeFile(join(staging, 'index.mjs'),
      'export { default } from "./dist/src/index.js";\n');
    const sourceManifest = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
    await writeFile(join(staging, 'package.json'), JSON.stringify({
      ...sourceManifest, main: 'index.mjs', files: ['index.mjs', 'dist/src'],
      devDependencies: {},
    }));
    const archive = JSON.parse(invokeNpm(['pack', staging, '--ignore-scripts', '--json',
      '--pack-destination', temp]))[0].filename;
    const profile = join(temp, 'profile');
    await mkdir(profile);
    invokeNpm(['install', join(temp, archive), '--prefix', profile, '--ignore-scripts',
      '--no-save', '--no-package-lock', '--no-audit', '--no-fund']);
    const installedRoot = join(profile, 'node_modules/opencode-webbridge');
    const entry = join(installedRoot, 'dist/src/index.js');
    await access(entry); // A missing compiled root is a hard packaging error.
    const imported = await import(pathToFileURL(entry).href);
    assert.equal(imported.default?.id, 'opencode.webbridge',
      'actual packed root module is not loadable by Node');
    const packageEntrypoint = await import(pathToFileURL(join(installedRoot, 'index.mjs')).href);
    assert.equal(packageEntrypoint.default, imported.default,
      'packaged loader entry must re-export the real root identity');
    const configDir = join(temp, 'config');
    await mkdir(configDir);
    await Promise.all(['home', 'data', 'cache'].map((dir) => mkdir(join(temp, dir))));
    // OpenCode's confirmed native install lifecycle registers package DIRECTORY
    // URLs, not direct file module URLs (G143 and G150), then resolves main.
    const configuredRoot = pathToFileURL(installedRoot).href;
    const config = JSON.stringify({ plugins: [configuredRoot] });
    await writeFile(join(configDir, 'opencode.json'), config);
    const password = randomBytes(32).toString('hex');
    const port = await reservePort();
    const endpoint = `http://127.0.0.1:${port}`;
    child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
      cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HOME: join(temp, 'home'), XDG_CONFIG_HOME: configDir,
        XDG_DATA_HOME: join(temp, 'data'), XDG_CACHE_HOME: join(temp, 'cache'),
        OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: config,
        OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_SERVER_PASSWORD: password,
        ...env(9333) },
    });
    let logs = '';
    child.stdout?.on('data', (value: Buffer) => { logs = (logs + value.toString()).slice(-3000); });
    child.stderr?.on('data', (value: Buffer) => { logs = (logs + value.toString()).slice(-3000); });
    const headers = { Authorization: 'Basic ' +
      Buffer.from('opencode:' + password).toString('base64') };
    let active = false;
    let observed = 'none';
    let configFound = false, responseOk = false;
    for (let i = 0; i < 100 && child.exitCode === null; i++) {
      try {
        if (!configFound) {
          const configReply = await fetch(endpoint + '/api/config', {
            headers, signal: AbortSignal.timeout(700),
          });
          if (configReply.ok) {
            responseOk = true;
            const publicConfig = JSON.stringify(await configReply.json());
            configFound = publicConfig.includes(configuredRoot);
          }
        }
        const response = await fetch(endpoint + '/api/plugin', {
          headers, signal: AbortSignal.timeout(700),
        });
        if (response.ok) {
          const result = await response.json() as { data?: { id: string; state?: { status: string } }[] };
          observed = JSON.stringify(result.data?.filter((item) =>
            item.id.includes('webbridge') || item.state?.status !== 'active')
            .map((item) => [item.id, item.state?.status]));
          active = Boolean(result.data?.some((item) =>
            item.id === 'opencode.webbridge' && item.state?.status === 'active'));
          if (active) break;
        }
      } catch { /* expected startup attempts */ }
      await new Promise((done) => setTimeout(done, 150));
    }
    const logStates = (logs.match(/(?:error|fail|warn|plugin|webbridge)[^\r\n]{0,80}/ig) ?? [])
      .slice(-6).map((line) => line.replaceAll(password, '[REDACTED]')
        .replace(/(secret|token|key)\s*[:=]\s*\S+/ig, '$1=[REDACTED]'));
    assert.equal(active, true, 'ACTUAL npm-packed opt-in root was not loaded in CLI' +
      ` (exit=${child.exitCode}, inventory=${observed.slice(0, 500)},` +
      ` configReadable=${responseOk}, configuredRoot=${configFound},` +
      ` missingModule=${/ERR_MODULE_NOT_FOUND|Cannot find module/.test(logs)},` +
      ` pluginError=${/plugin.*error|failed to load/i.test(logs)},` +
      ` logStates=${JSON.stringify(logStates)})`);
    const providers = await fetch(endpoint + '/api/provider', {
      headers, signal: AbortSignal.timeout(3000),
    });
    assert.equal(providers.ok, true);
    const result = JSON.stringify(await providers.json());
    assert.doesNotMatch(result, /webbridge-(chatgpt|deepseek|gemini|qwen|mistral)/,
      'unproven fake provider must not be advertised');
  } finally {
    if (child?.exitCode === null) child.kill();
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
