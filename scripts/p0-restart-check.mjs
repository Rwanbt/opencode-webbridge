/** P0 restart proof: with the SAME disposable profile, plugin install and durable
 *  journal as a live P0 run, restart the official CLI and read the persisted
 *  session back. No prompt is sent here (no second browser effect).
 *
 *  Usage: P0_TEMP=<p0-live-... dir> node scripts/p0-restart-check.mjs */
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const WINDOWS = process.platform === 'win32';
const temp = process.env.P0_TEMP;
const expectText = process.env.P0_EXPECT ?? '2 + 2 = 4.';
if (!temp) throw new Error('P0_TEMP is required');
const root = resolve('.');
const cli = WINDOWS
  ? join(root, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
  : join(root, 'node_modules', '.bin', 'opencode');

async function freePort() {
  const server = createServer();
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}

const configPath = join(temp, 'config', 'opencode.json');
const config = await readFile(configPath, 'utf8');
const installed = JSON.parse(await readFile(join(temp, 'installed', 'node_modules', 'opencode-webbridge', 'package.json'), 'utf8'));
assert.equal(installed.name, 'opencode-webbridge');
const password = randomBytes(24).toString('hex');
const bind = await freePort();
const child = spawn(cli, ['serve', '--hostname', '127.0.0.1', '--port', String(bind)], {
  cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOME: join(temp, 'home'),
    ...(WINDOWS ? { USERPROFILE: join(temp, 'home') } : {}),
    XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data'),
    XDG_CACHE_HOME: join(temp, 'cache'), OPENCODE_CONFIG_DIR: join(temp, 'config'),
    OPENCODE_CONFIG_CONTENT: config, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_SERVER_PASSWORD: password,
    WEBBRIDGE_NATIVE_WEB_MODELS: 'chatgpt',
    WEBBRIDGE_NATIVE_TAB_CHATGPT: process.env.P0_TAB_CHATGPT ?? '',
    WEBBRIDGE_NATIVE_JOURNAL_DIR: join(temp, 'journal') },
});
let log = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', (v) => { log = (log + v.toString()).slice(-2000); });
const base = 'http://127.0.0.1:' + bind;
const headers = { Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64') };
const api = async (p) => {
  const r = await fetch(base + p, { headers, signal: AbortSignal.timeout(8000) });
  assert.equal(r.ok, true, 'restart API ' + p + ' HTTP ' + r.status);
  return r.json();
};
const stop = async () => {
  if (child.exitCode !== null) return;
  if (WINDOWS && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
  else child.kill();
  await Promise.race([new Promise((ok) => child.once('close', ok)), new Promise((ok) => setTimeout(ok, 2500))]);
};
try {
  let ready = false;
  for (let i = 0; i < 120 && child.exitCode === null; i++) {
    try {
      const r = await fetch(base + '/api/plugin', { headers, signal: AbortSignal.timeout(800) });
      if (r.ok) { ready = true; break; }
    } catch { /* bounded startup */ }
    await new Promise((ok) => setTimeout(ok, 200));
  }
  assert.ok(ready, 'restarted CLI never became ready: ' + log.slice(-500));
  const sessions = await api('/api/session?limit=100');
  assert.ok(Array.isArray(sessions.data) && sessions.data.length > 0, 'no persisted session after restart');
  const sessionID = sessions.data[0].id;
  const detail = await api('/api/session/' + encodeURIComponent(sessionID));
  assert.equal(detail.data.id, sessionID);
  const messages = await api('/api/session/' + encodeURIComponent(sessionID) + '/message?limit=100');
  const all = messages.data ?? [];
  const text = (m) => (m.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join('');
  const user = all.find((m) => m.type === 'user');
  const assistant = all.find((m) => m.type === 'assistant' && text(m).includes(expectText));
  assert.ok(user, 'persisted user prompt missing after restart');
  assert.ok(assistant, 'persisted assistant answer missing after restart');
  console.log(JSON.stringify({
    verdict: 'P0_RESTART_PERSISTED',
    sessionID,
    sessionTitle: detail.data.title,
    messageCount: all.length,
    userPromptPersisted: true,
    assistantTextPersisted: true,
    assistantFinish: assistant.finish ?? null,
    assistantText: text(assistant),
  }, null, 1));
} finally {
  await stop();
}
