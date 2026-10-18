/** W13: the RAW published root + unmodified official 2.0.32 CLI + synthetic HTTPS Chromium.
 * There is no commercial authentication here. A visible DOM candidate is NOT provider finality.
 * Runs only in isolated Linux CI with W13_NATIVE_CLI=1, never against a user's profile.
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ACTIVE = process.platform === 'linux' && process.env.W13_NATIVE_CLI === '1';
const CLI = join(ROOT, 'node_modules/.bin/opencode');
const PROVIDER = 'webbridge-chatgpt';
const MODEL = PROVIDER + '/chatgpt-web';
const PROMPT = 'W13_CHROMIUM_NATIVE_RAW_PACKAGE_PROMPT';
const CANDIDATE = 'W13_VISIBLE_PROVISIONAL_REPLY';
const SECRET = 'W13_DO_NOT_LEAK_COOKIE_OR_CREDENTIAL';
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const server = createServer();
  await new Promise((ok, no) => {
    server.once('error', no);
    server.listen(0, '127.0.0.1', ok);
  });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
function npm(args, cwd, timeout = 240_000) {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', timeout,
    maxBuffer: 2_000_000, env: { ...process.env, npm_config_audit: 'false',
      npm_config_fund: 'false' } });
  assert.equal(result.status, 0,
    'npm ' + args[0] + ': ' + (result.error?.message ?? result.stderr ?? '').slice(-700));
  return result.stdout;
}
async function installRaw(temp) {
  const stage = join(temp, 'source');
  await mkdir(stage);
  for (const file of ['src', 'bin', 'index.mjs', 'package.json', 'tsconfig.json',
    'tsconfig.pack.json', 'README.md', 'LICENSE', 'SECURITY.md', 'THIRD-PARTY-NOTICES.md']) {
    await cp(join(ROOT, file), join(stage, file), { recursive: true });
  }
  await mkdir(join(stage, 'scripts'));
  await cp(join(ROOT, 'scripts/g164-prepare-package.mjs'),
    join(stage, 'scripts/g164-prepare-package.mjs'));
  await symlink(join(ROOT, 'node_modules'), join(stage, 'node_modules'), 'dir');
  const metadata = JSON.parse(npm(['pack', '--json', '--pack-destination', temp], stage))[0];
  const paths = metadata.files.map((file) => file.path);
  for (const path of ['index.mjs', 'dist/src/index.js', 'dist/src/native/registration.js',
    'dist/src/native/consented-cdp-attachment.js', 'dist/src/providers/g159-chatgpt-approved-send.js'])
    assert.ok(paths.includes(path), 'RAW npm pack omitted ' + path);
  assert.ok(paths.every((path) => !path.includes('test/') && !path.includes('.env')),
    'raw artifact contains test or secrets');
  const installed = join(temp, 'installed');
  npm(['install', join(temp, metadata.filename), '--prefix', installed,
    '--ignore-scripts', '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], temp);
  const dir = join(installed, 'node_modules/opencode-webbridge');
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.0.0');
  return dir;
}
async function launch(temp, plugin, label, extra) {
  const conf = join(temp, 'config-' + label);
  const home = join(temp, 'home-' + label);
  const data = join(temp, 'data');
  const cache = join(temp, 'cache');
  await Promise.all([conf, home, data, cache].map((path) => mkdir(path, { recursive: true })));
  const config = JSON.stringify({ plugins: [pathToFileURL(plugin).href] });
  await writeFile(join(conf, 'opencode.json'), config);
  const port = await freePort();
  const password = randomBytes(32).toString('hex');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: conf, XDG_DATA_HOME: data,
    XDG_CACHE_HOME: cache, OPENCODE_CONFIG_DIR: conf, OPENCODE_CONFIG_CONTENT: config,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_SERVER_PASSWORD: password,
    WEBBRIDGE_G150_LOCAL_FIXTURE: '0', WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt',
    ...extra };
  const server = spawn(CLI, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temp, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [server.stdout, server.stderr])
    stream.on('data', (b) => { output = (output + b.toString()).slice(-4000); });
  const host = { url: 'http://127.0.0.1:' + port, env,
    headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') },
    logs: () => output.replaceAll(password, '[REDACTED]'),
    stop: async () => {
      if (server.exitCode === null) server.kill();
      await Promise.race([new Promise((ok) => server.once('close', ok)), pause(2500)]);
    },
  };
  for (let i = 0; i < 120 && server.exitCode === null; i++) {
    try {
      const p = await request(host, '/api/plugin');
      const m = await request(host, '/api/model');
      if (p.data?.some((item) => item.id === 'opencode.webbridge' &&
        item.state?.status === 'active') &&
        m.data?.some((item) => item.providerID === PROVIDER &&
          item.modelID === 'chatgpt-web' && item.enabled === true)) return host;
    } catch { /* bounded startup only */ }
    await pause(200);
  }
  await host.stop();
  throw new Error('official 2.0.32 CLI did not activate packaged native model: ' +
    host.logs().slice(-800));
}
async function request(host, path) {
  const response = await fetch(host.url + path, {
    headers: host.headers, signal: AbortSignal.timeout(1500),
  });
  assert.equal(response.ok, true, path + ': HTTP ' + response.status);
  return response.json();
}
async function priorSessions(host) {
  return new Set((await request(host, '/api/session?limit=100')).data?.map(
    (session) => session.id) ?? []);
}
function run(host, prompt) {
  const child = spawn(CLI, ['run', '--server', host.url, '--model', MODEL,
    '--format', 'json', prompt], { cwd: ROOT, env: host.env, shell: false,
    stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (b) => { stdout = (stdout + b.toString()).slice(-150_000); });
  child.stderr.on('data', (b) => { stderr = (stderr + b.toString()).slice(-3000); });
  const finished = new Promise((ok, no) => {
    child.once('error', no); child.once('close', ok);
  });
  return { output: () => stdout + '\n' + stderr,
    stop: async () => {
      if (child.exitCode === null) child.kill();
      await Promise.race([finished, pause(2500)]);
    } };
}
async function observed(host, fragment, timeout = 35_000, exclude = new Set()) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const sessions = await request(host, '/api/session?limit=20');
      for (const session of sessions.data ?? []) {
        // The same official data directory intentionally survives restart;
        // an old persisted turn may never satisfy a NEW invocation's checks.
        if (exclude.has(session.id)) continue;
        const messages = await request(host, '/api/session/' +
          encodeURIComponent(session.id) + '/message?limit=30');
        const data = JSON.stringify(messages.data ?? []);
        if (data.includes(fragment)) return data;
        last = data;
      }
    } catch { /* only transient server readiness; assertions after budget */ }
    await pause(300);
  }
  throw new Error('official persisted session missing ' + fragment +
    '; last=' + last.slice(-500) + ' host=' + host.logs().slice(-500));
}
function fixtureHTML() {
  return [
    '<!doctype html><html><body>',
    '<article data-turn="assistant" data-turn-id="prior"><div class="markdown">PRIOR_PRIVATE_ANSWER</div></article>',
    '<div id="prompt-textarea" contenteditable="true" role="textbox"></div>',
    '<button data-testid="send-button" disabled>Send</button>',
    '<input type="password" value="' + SECRET + '">',
    '<script>',
    'window.sent=[];',
    'const editor=document.getElementById("prompt-textarea");',
    'const button=document.querySelector("button");',
    'editor.addEventListener("input",()=>button.disabled=!editor.textContent.trim());',
    'button.addEventListener("click",()=>{',
    '  window.sent.push(editor.textContent); editor.textContent=""; button.disabled=true;',
    '  setTimeout(()=>document.body.insertAdjacentHTML("beforeend",',
    '    \x27<article data-turn="assistant" data-turn-id="candidate1"><div class="markdown">W13_VISIBLE_</div></article>\x27),50);',
    '  setTimeout(()=>{const x=document.querySelector("[data-turn-id=candidate1] .markdown");',
    '    if(x)x.textContent="W13_VISIBLE_PROVISIONAL_REPLY";},2800);',
    '});',
    '</script></body></html>',
  ].join('\n');
}
async function createBrowser(temp) {
  const profile = join(temp, 'chromium-profile');
  const port = await freePort();
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, args: ['--remote-debugging-port=' + port, '--no-first-run'],
    serviceWorkers: 'block', acceptDownloads: false,
  });
  const page = context.pages()[0] ?? await context.newPage();
  await page.route('https://chatgpt.com/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: fixtureHTML(),
  }));
  await page.goto('https://chatgpt.com/c/w13-synthetic', { waitUntil: 'domcontentloaded' });
  const session = await page.context().newCDPSession(page);
  const info = await session.send('Target.getTargetInfo');
  await session.detach();
  assert.match(info.targetInfo.targetId, /^[A-Za-z0-9_-]{4,128}$/);
  return { context, page, endpoint: 'http://127.0.0.1:' + port,
    tabID: info.targetInfo.targetId };
}
const sent = (page) => page.evaluate(() => window.sent);

test('W13 raw npm root -> unmodified CLI 2.0.32 -> intercepted HTTPS Chromium; authority, progressive UNCERTAIN, restart anti-replay',
  { skip: !ACTIVE, timeout: 240_000 }, async () => {
    assert.equal(JSON.parse(await readFile(join(ROOT, 'node_modules/@opencode/cli/package.json'))).version,
      '2.0.32', 'use exact unmodified official CLI');
    const temp = await mkdtemp(join(tmpdir(), 'webbridge-w13-'));
    let browser, host, command;
    try {
      const plugin = await installRaw(temp);
      browser = await createBrowser(temp);
      const journal = join(temp, 'private-journal');
      await mkdir(journal, { mode: 0o700 });
      const selection = { WEBBRIDGE_NATIVE_TAB_CHATGPT: browser.endpoint + '#' + browser.tabID,
        WEBBRIDGE_NATIVE_JOURNAL_DIR: journal };

      // Registered native model without declared tab is selectable but cannot attach/send.
      host = await launch(temp, plugin, 'preconsent', {});
      let before = await priorSessions(host);
      command = run(host, PROMPT + '_NO_CONSENT');
      const refusal = await observed(host, 'no attached authorized browser session', 25_000, before);
      assert.doesNotMatch(refusal, /W13_VISIBLE_|PRIOR_PRIVATE_ANSWER|W13_DO_NOT_LEAK/);
      assert.deepEqual(await sent(browser.page), []);
      await command.stop(); command = undefined;
      await host.stop(); host = undefined;

      // Explicit declaration with nonexistent selected CDP target: refuse before effect.
      host = await launch(temp, plugin, 'bad-tab', {
        ...selection, WEBBRIDGE_NATIVE_TAB_CHATGPT: browser.endpoint + '#nonexistent_12345',
      });
      before = await priorSessions(host);
      command = run(host, PROMPT + '_BAD_TAB');
      const badTab = await observed(host, 'no attached authorized browser session', 25_000, before);
      assert.doesNotMatch(badTab, /W13_VISIBLE_|PRIOR_PRIVATE_ANSWER|W13_DO_NOT_LEAK/);
      assert.deepEqual(await sent(browser.page), []);
      await command.stop(); command = undefined;
      await host.stop(); host = undefined;

      // Even an authorized tab cannot be written while the human has a draft.
      const privateDraft = 'W13_HUMAN_DRAFT_KEEP_UNMODIFIED';
      await browser.page.locator('#prompt-textarea').fill(privateDraft);
      host = await launch(temp, plugin, 'existing-draft', selection);
      before = await priorSessions(host);
      command = run(host, PROMPT + '_DRAFT_REFUSAL');
      await observed(host, 'nonempty user draft', 25_000, before);
      assert.deepEqual(await sent(browser.page), []);
      assert.equal(await browser.page.locator('#prompt-textarea').textContent(), privateDraft);
      await command.stop(); command = undefined;
      await host.stop(); host = undefined;
      await browser.page.locator('#prompt-textarea').fill('');

      // Real packaged root model -> CDP selected synthetic HTTPS page -> one UI click.
      host = await launch(temp, plugin, 'approved', selection);
      before = await priorSessions(host);
      command = run(host, PROMPT);
      let first;
      try {
        first = await observed(host, 'W13_VISIBLE_', 35_000, before);
      } catch (error) {
        const displayed = await browser.page.locator('[data-turn-id="candidate1"] .markdown')
          .textContent().catch(() => null);
        throw new Error('W13 progressive native failure: clicks=' +
          JSON.stringify(await sent(browser.page)) + ' browserText=' +
          JSON.stringify(displayed) + ' journalFiles=' +
          JSON.stringify(await readdir(journal)) + ' CLI=' +
          command.output().slice(-600), { cause: error });
      }
      assert.doesNotMatch(first, /W13_VISIBLE_PROVISIONAL_REPLY/,
        'only final DOM text was persisted; no progressive model event was proved');
      const progress = await observed(host, CANDIDATE, 25_000, before);
      assert.deepEqual(await sent(browser.page), [PROMPT]);
      assert.doesNotMatch(progress, /PRIOR_PRIVATE_ANSWER|W13_DO_NOT_LEAK/);
      // We must never claim a provider's actual completion on a DOM-only fixture.
      const uncertain = await observed(host, 'webbridge-terminal-uncertain', 48_000, before);
      assert.match(uncertain, /"finish"\s*:\s*"error"|webbridge-terminal-uncertain/);
      assert.doesNotMatch(uncertain, /webbridge-dom-completion-observed/);
      assert.deepEqual(await sent(browser.page), [PROMPT]);
      await command.stop(); command = undefined;
      await host.stop(); host = undefined;
      const files = await readdir(journal);
      assert.ok(files.some((file) => file.startsWith('attempt-')));
      assert.equal(files.filter((file) => file.endsWith('.g159-once')).length, 1);

      // Same prompt with persisted journal after official daemon restart: no re-send.
      host = await launch(temp, plugin, 'restart', selection);
      before = await priorSessions(host);
      command = run(host, PROMPT);
      // Production polling is 64 * 500 ms (~32 s). A shorter timeout can
      // falsely fail a correct resumed UNCERTAIN while the model still polls.
      await observed(host, 'webbridge-terminal-uncertain', 48_000, before);
      assert.deepEqual(await sent(browser.page), [PROMPT],
        'native CLI restart replayed a previously clicked prompt');
      assert.equal((await readdir(journal)).filter((file) => file.endsWith('.g159-once')).length, 1);
      await command.stop(); command = undefined;
      await host.stop(); host = undefined;
    } finally {
      await command?.stop();
      await host?.stop();
      await browser?.context.close();
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    }
  });
