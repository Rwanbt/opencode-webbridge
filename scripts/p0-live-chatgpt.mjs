/** P0 LIVE: raw npm tarball -> official OpenCode CLI 2.0.32 -> native model ->
 *  consented CDP tab (real ChatGPT session) -> one prompt -> progressive answer
 *  -> durable attempt journal -> persistent session -> restart.
 *
 *  Consent model: the operator declares ONE already-open loopback CDP tab via
 *  WEBBRIDGE_NATIVE_TAB_CHATGPT and a private journal dir. Nothing here reads
 *  cookies, tokens or passwords.
 *
 *  Honesty: the ChatGPT DOM has no proven completion signal, so the turn MUST
 *  end uncertain (finish "error"), never a fabricated "stop".
 *
 *  Usage: node scripts/p0-live-chatgpt.mjs */
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const WINDOWS = process.platform === 'win32';
const NAME = 'opencode-webbridge';
const root = resolve('.');
const cli = WINDOWS
  ? join(root, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
  : join(root, 'node_modules', '.bin', 'opencode');
const tabDeclaration = process.env.P0_TAB_CHATGPT ?? '';
const prompt = process.env.P0_PROMPT ?? 'Réponds en une seule phrase courte: combien font 2 + 2 ?';

const ex = (file, args, options) => {
  const result = spawnSync(file, args, {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' }, ...options,
  });
  assert.equal(result.status, 0, file + ' ' + args.slice(0, 2).join(' ') + ' failed: ' +
    String(result.stderr ?? '').slice(-700));
  return result.stdout;
};
const npm = (args, cwd) => ex(WINDOWS ? 'npm.cmd' : 'npm', args, { cwd, shell: WINDOWS });

async function freePort() {
  const server = createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

async function startServer({ temp, config, env }) {
  const configDir = join(temp, 'config');
  for (const dir of ['home', 'data', 'cache']) await mkdir(join(temp, dir), { recursive: true });
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'opencode.json'), config);
  const password = randomBytes(24).toString('hex');
  const bind = await freePort();
  const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(bind)], {
    cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: join(temp, 'home'),
      ...(WINDOWS ? { USERPROFILE: join(temp, 'home') } : {}),
      XDG_CONFIG_HOME: configDir, XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CONFIG_CONTENT: config, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_SERVER_PASSWORD: password, ...env },
  });
  let log = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (v) => { log = (log + v.toString()).slice(-3000); });
  return {
    child, password,
    base: 'http://127.0.0.1:' + bind,
    headers: { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') },
    diagnostic: () => log.replaceAll(password, '[REDACTED]').slice(-900),
    stop: async () => {
      if (child.exitCode !== null) return;
      if (WINDOWS && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
      else child.kill();
      await Promise.race([new Promise((done) => child.once('close', done)), new Promise((done) => setTimeout(done, 2500))]);
    },
  };
}

async function api(host, path, init = {}) {
  const reply = await fetch(host.base + path, {
    ...init, headers: { ...host.headers, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8000),
  });
  return { status: reply.status, ok: reply.ok, body: reply.ok ? await reply.json().catch(() => null) : null };
}

async function waitReady(host) {
  for (let i = 0; i < 120 && host.child.exitCode === null; i++) {
    try {
      const r = await fetch(host.base + '/api/plugin', { headers: host.headers, signal: AbortSignal.timeout(800) });
      if (r.ok) return;
    } catch { /* bounded startup retry */ }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error('official CLI never became ready: ' + host.diagnostic());
}

async function waitPlugin(host) {
  for (let i = 0; i < 120 && host.child.exitCode === null; i++) {
    const r = await api(host, '/api/plugin');
    if (r.ok && r.body?.data?.some((p) => p.id === 'opencode.webbridge' && p.state?.status === 'active')) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  const inv = await api(host, '/api/plugin');
  throw new Error('plugin never active: ' + JSON.stringify(inv.body?.data?.map((p) => [p.id, p.state?.status])) +
    ' diag=' + host.diagnostic());
}

async function runPrompt(host, env) {
  return new Promise((done) => {
    const child = spawn(cli, ['run', '--server', host.base, '--model', 'webbridge-chatgpt/chatgpt-web',
      '--format', 'json', prompt], {
      cwd: host.cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OPENCODE_SERVER_PASSWORD: host.password, ...env },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (v) => { stdout += v.toString(); });
    child.stderr.on('data', (v) => { stderr = (stderr + v.toString()).slice(-1500); });
    const timer = setTimeout(() => child.kill(), 180_000);
    child.once('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}

async function main() {
  if (!tabDeclaration) throw new Error('P0_TAB_CHATGPT="http://127.0.0.1:<port>#<tabID>" is required');
  assert.match(tabDeclaration, /^http:\/\/127\.0\.0\.1:\d+#[A-Za-z0-9_-]{4,128}$/);
  const temp = await mkdtemp(join(tmpdir(), 'p0-live-'));
  const journal = join(temp, 'journal');
  await mkdir(journal, { recursive: true, mode: 0o700 });
  const packDir = join(temp, 'pack');
  await mkdir(packDir);

  console.log('[1/7] packing the real tarball');
  const packOut = npm(['pack', root, '--json', '--pack-destination', packDir], root);
  const meta = JSON.parse(packOut.slice(packOut.indexOf('[')))[0];
  const archive = join(packDir, meta.filename);
  const files = new Set(meta.files.map((f) => f.path));
  for (const required of ['package.json', 'index.mjs', 'dist/src/index.js', 'dist/src/native/registration.js',
    'dist/src/native/consented-transport.js', 'dist/src/providers/g159-chatgpt-approved-send.js'])
    assert.ok(files.has(required), 'tarball misses ' + required);

  console.log('[2/7] installing the raw tarball into a disposable prefix');
  const prefix = join(temp, 'installed');
  npm(['install', archive, '--prefix', prefix, '--ignore-scripts', '--no-save',
    '--no-package-lock', '--no-audit', '--no-fund'], temp);
  const installed = join(prefix, 'node_modules', NAME);
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.name, NAME);

  const config = JSON.stringify({ plugins: [pathToFileURL(installed).href] });
  const env = { WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt', WEBBRIDGE_NATIVE_TAB_CHATGPT: tabDeclaration,
    WEBBRIDGE_NATIVE_JOURNAL_DIR: journal };

  console.log('[3/7] starting the official CLI and waiting for the plugin');
  const host = await startServer({ temp, config, env });
  host.cwd = temp;
  try {
    await waitReady(host);
    await waitPlugin(host);

    console.log('[4/7] provider/model discovery');
    const providers = await api(host, '/api/provider');
    const providerJSON = JSON.stringify(providers.body ?? {});
    assert.ok(providerJSON.includes('webbridge-chatgpt'), 'webbridge-chatgpt provider not listed');
    console.log('PROVIDER_JSON ' + providerJSON.slice(0, 2500));

    console.log('[5/7] one prompt through the native model (single browser send expected)');
    const started = Date.now();
    const run = await runPrompt(host, env);
    const elapsedMs = Date.now() - started;
    console.log('RUN_DEBUG ' + JSON.stringify({ code: run.code, elapsedMs,
      stdoutTail: run.stdout.slice(-900), stderrTail: run.stderr.slice(-700),
      server: host.diagnostic() }));

    console.log('[6/7] session persistence');
    const list = await api(host, '/api/session?limit=100');
    assert.ok(Array.isArray(list.body?.data), 'session list unavailable');
    assert.ok(list.body.data.length > 0, 'no session created');
    const sessionID = list.body.data[0].id;
    const messages = await api(host, '/api/session/' + encodeURIComponent(sessionID) + '/message?limit=100');
    const all = messages.body?.data ?? [];
    const text = (m) => (m.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    const user = all.find((m) => m.type === 'user');
    const assistant = all.find((m) => m.type === 'assistant');

    console.log('[7/7] durable attempt journal');
    const journalFiles = await readdir(journal);

    console.log(JSON.stringify({
      verdict: 'P0_LIVE_OBSERVED',
      cliVersion: '2.0.32',
      model: 'webbridge-chatgpt/chatgpt-web',
      tab: tabDeclaration.replace(/#.*/, '#<tab>'),
      runExit: run.code,
      elapsedMs,
      userPromptPersisted: Boolean(user && (user.text ?? '').includes(prompt.slice(0, 20))),
      assistantPersisted: Boolean(assistant),
      assistantFinish: assistant?.finish ?? null,
      assistantTextLength: assistant ? text(assistant).length : 0,
      assistantTail: assistant ? text(assistant).slice(-120) : null,
      sessionID,
      messageCount: all.length,
      journalFiles,
      serverDiagnostic: host.diagnostic(),
      stdoutTail: run.stdout.slice(-600),
      stderrTail: run.stderr.slice(-400),
    }, null, 1));

    fsCleanup(temp);
  } finally {
    await host.stop();
  }
}

function fsCleanup() { /* keep the temp dir for inspection */ }

main().catch((error) => {
  console.error('P0 LIVE FAILED:', error?.message ?? error);
  process.exitCode = 1;
});
