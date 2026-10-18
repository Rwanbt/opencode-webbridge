/** G164: raw npm pack -> unmodified official CLI 2.0.32; no staged dist or app mutation. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'opencode-webbridge';
const WINDOWS = process.platform === 'win32';
const NATIVE = (process.platform === 'linux' || WINDOWS) && process.env.G164_OFFICIAL_CLI === '1';
const digest = (s) => createHash('sha256').update(s).digest('hex');
// Windows cannot spawn npm's cmd shim without a shell; reuse the npm that runs beside this Node.
let npmCli;
const resolveNpmCli = () => {
  if (npmCli !== undefined) return npmCli;
  npmCli = WINDOWS
    ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
       join(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
        .find((candidate) => existsSync(candidate)) ?? null
    : null;
  if (WINDOWS && !npmCli)
    throw new Error('G164 cannot locate npm-cli.js beside ' + process.execPath);
  return npmCli;
};
const execNpm = (args, cwd, timeout = 120_000) => {
  const cli = resolveNpmCli();
  const options = {
    cwd, env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true,
  };
  const result = cli
    ? spawnSync(process.execPath, [cli, ...args], options)
    : spawnSync('npm', args, options);
  assert.equal(result.status, 0, 'npm ' + args[0] + ' failed (' +
    (result.error?.code ?? result.signal ?? 'status ' + result.status) + '): ' +
    (result.stderr ?? '').slice(-900));
  return result.stdout;
};
const parsed = (output) => JSON.parse(output.slice(output.indexOf('[')))[0];
async function pack(directory, destination, version, scripts = true) {
  const args = ['pack', directory, '--json', '--pack-destination', destination];
  if (!scripts) args.push('--ignore-scripts');
  const meta = parsed(execNpm(args, destination));
  assert.equal(meta.name, NAME);
  assert.equal(meta.version, version);
  return { meta, path: join(destination, meta.filename) };
}
function packageContract(meta) {
  const paths = meta.files.map((item) => item.path);
  for (const required of ['package.json', 'index.mjs', 'dist/src/index.js',
    'dist/src/index.d.ts', 'dist/src/runtime/g163-root-read.js',
    'dist/src/browser/explicit-cdp-read.js', 'dist/src/runtime/g166-chatgpt-manual-turn.js',
    'dist/src/providers/provider-adapters.js', 'dist/src/runtime/observe-provider.js',
    'dist/src/native/journal-operator.js', 'dist/src/runtime/readonly-tools.js',
    'bin/webbridge-manual-chatgpt.mjs', 'bin/webbridge-manual-observe.mjs',
    'bin/webbridge-journal.mjs']) {
    assert.ok(paths.includes(required), 'raw tarball misses ' + required);
  }
  assert.ok(paths.every((path) => path === 'package.json' || path === 'index.mjs' ||
    /^bin\/webbridge-(manual-(chatgpt|observe)|journal)\.mjs$/.test(path) ||
    /^(README.md|LICENSE|SECURITY.md|THIRD-PARTY-NOTICES.md)$/.test(path) ||
    path.startsWith('dist/src/')), 'release tarball leaked source/tests/fixtures');
  assert.ok(!paths.some((path) => path.startsWith('dist/src/testing/') ||
    path.includes('.env') || path.endsWith('.map')), 'test harness or private assets packaged');
  assert.ok(meta.size < 2_000_000, 'unbounded package size');
}
async function sourceVariant(temp) {
  const work = join(temp, 'version-0.0.1-source');
  await mkdir(work);
  // Variant is SOURCE ONLY; npm's normal prepack compiles it. Never stage emitted dist.
  for (const name of ['src', 'test']) await cp(join(repo, name), join(work, name), { recursive: true });
  for (const name of ['tsconfig.json', 'package-lock.json']) {
    await cp(join(repo, name), join(work, name));
  }
  await cp(join(repo, 'index.mjs'), join(work, 'index.mjs'));
  await cp(join(repo, 'bin'), join(work, 'bin'), { recursive: true });
  await cp(join(repo, 'tsconfig.pack.json'), join(work, 'tsconfig.pack.json'));
  await mkdir(join(work, 'scripts'));
  await cp(join(repo, 'scripts/g164-prepare-package.mjs'),
    join(work, 'scripts/g164-prepare-package.mjs'));
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  manifest.version = '0.0.1';
  await writeFile(join(work, 'package.json'), JSON.stringify(manifest) + '\n');
  await symlink(join(repo, 'node_modules'), join(work, 'node_modules'),
    WINDOWS ? 'junction' : 'dir');
  return work;
}
async function port() {
  const socket = createServer();
  await new Promise((ok, no) => {
    socket.once('error', no);
    socket.listen(0, '127.0.0.1', ok);
  });
  const n = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  return n;
}
async function spawnOfficialCLI(temp, label, config) {
  const configDir = join(temp, 'config-' + label);
  for (const dir of ['home', 'data', 'cache', 'config-' + label])
    await mkdir(join(temp, dir), { recursive: true });
  await writeFile(join(configDir, 'opencode.json'), config);
  const pwd = randomBytes(32).toString('hex');
  const bind = await port();
  const bin = WINDOWS
    ? join(repo, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
    : join(repo, 'node_modules/.bin/opencode');
  const server = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(bind)], {
    cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: join(temp, 'home'),
      ...(WINDOWS ? { USERPROFILE: join(temp, 'home') } : {}),
      XDG_CONFIG_HOME: configDir, XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CONFIG_CONTENT: config, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_SERVER_PASSWORD: pwd, WEBBRIDGE_PERSONAL_CDP_READONLY: '1',
      WEBBRIDGE_PERSONAL_BROWSER_OWNED: '1',
      WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://127.0.0.1:9333',
      WEBBRIDGE_G150_LOCAL_FIXTURE: '0' },
  });
  let log = '';
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (value) => { log = (log + value.toString()).slice(-2500); });
  }
  return { server,
    base: 'http://127.0.0.1:' + bind,
    headers: { Authorization: 'Basic ' +
      Buffer.from('opencode:' + pwd).toString('base64') },
    diagnostic: () => log.replaceAll(pwd, '[REDACTED]').slice(-600),
    stop: async () => {
      if (server.exitCode === null && WINDOWS && server.pid)
        spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true });
      else if (server.exitCode === null) server.kill();
      await Promise.race([new Promise((done) => server.once('close', done)),
        new Promise((done) => setTimeout(done, 2500))]);
    } };
}
async function waitReady(host) {
  for (let i = 0; i < 100 && host.server.exitCode === null; i++) {
    try {
      const reply = await fetch(host.base + '/api/plugin', {
        headers: host.headers, signal: AbortSignal.timeout(650),
      });
      if (reply.ok) return reply.json();
    } catch { /* bounded startup retry */ }
    await new Promise((done) => setTimeout(done, 160));
  }
  throw new Error('official CLI never became ready, diagnostic=' + host.diagnostic());
}
async function waitPluginActive(host) {
  let inventory = 'none';
  for (let i = 0; i < 100 && host.server.exitCode === null; i++) {
    try {
      const reply = await fetch(host.base + '/api/plugin', {
        headers: host.headers, signal: AbortSignal.timeout(650),
      });
      if (reply.ok) {
        const result = await reply.json();
        inventory = JSON.stringify(result.data?.filter((item) =>
          /webbridge|failed/i.test(item?.id ?? '')).map((item) =>
          ({ id: item.id, status: item.state?.status })));
        if (result.data?.some((item) => item.id === 'opencode.webbridge' &&
          item.state?.status === 'active')) return;
      }
    } catch { /* bounded startup retry */ }
    await new Promise((done) => setTimeout(done, 160));
  }
  throw new Error('official CLI never activated the installed raw root, inventory=' +
    inventory + ' diagnostic=' + host.diagnostic());
}
async function pluginInventory(host) {
  const reply = await fetch(host.base + '/api/plugin', {
    headers: host.headers, signal: AbortSignal.timeout(3000),
  });
  assert.equal(reply.ok, true, 'official plugin inventory unavailable');
  return (await reply.json()).data ?? [];
}
async function officialSession(host, title) {
  const reply = await fetch(host.base + '/api/session', { method: 'POST',
    headers: { ...host.headers, 'content-type': 'application/json' },
    body: JSON.stringify({ title }), signal: AbortSignal.timeout(5000) });
  assert.equal(reply.ok, true, 'official session create failed HTTP ' + reply.status);
  const body = await reply.json();
  assert.match(body?.data?.id ?? '', /^ses_[a-zA-Z0-9_-]+$/, 'invalid official session id');
  assert.equal(body.data.title, title);
  return body.data.id;
}
async function assertSessionIntact(host, sessionID, title) {
  const list = await fetch(host.base + '/api/session?limit=100', {
    headers: host.headers, signal: AbortSignal.timeout(5000),
  });
  assert.equal(list.ok, true, 'official session list unavailable');
  assert.ok((await list.json()).data?.some((session) => session.id === sessionID),
    'persisted session missing from official list');
  const detail = await fetch(host.base + '/api/session/' + encodeURIComponent(sessionID), {
    headers: host.headers, signal: AbortSignal.timeout(5000),
  });
  assert.equal(detail.ok, true, 'official session detail unavailable');
  assert.equal((await detail.json())?.data?.title, title, 'persisted session title corrupted');
  const messages = await fetch(host.base + '/api/session/' + encodeURIComponent(sessionID) +
    '/message?limit=100', { headers: host.headers, signal: AbortSignal.timeout(5000) });
  assert.equal(messages.ok, true, 'official session history unavailable');
  assert.ok(Array.isArray((await messages.json())?.data), 'official message history missing');
}
async function nativeProof(prefix, temp, stage) {
  const installed = join(prefix, 'node_modules', NAME);
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const main = await readFile(join(installed, 'dist/src/index.js'));
  assert.equal(pkg.main, './index.mjs');
  const canonical = (await import(pathToFileURL(join(installed, 'dist/src/index.js')).href +
    '?g164=' + stage)).default;
  const installedEntry = (await import(pathToFileURL(join(installed, 'index.mjs')).href +
    '?g164=' + stage)).default;
  assert.equal(canonical.id, 'opencode.webbridge');
  assert.equal(installedEntry.id, canonical.id, 'published index.mjs does not export real root');
  // Version metadata changes, not the actual root entrypoint; rollback must restore bytes.
  const configDir = join(temp, 'config-' + stage);
  for (const dir of ['home', 'data', 'cache', 'config-' + stage])
    await mkdir(join(temp, dir), { recursive: true });
  const config = JSON.stringify({ plugins: [pathToFileURL(installed).href] });
  await writeFile(join(configDir, 'opencode.json'), config);
  const pwd = randomBytes(32).toString('hex');
  const bind = await port();
  const bin = WINDOWS
    ? join(repo, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe')
    : join(repo, 'node_modules/.bin/opencode');
  const server = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(bind)], {
    cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: join(temp, 'home'),
      ...(WINDOWS ? { USERPROFILE: join(temp, 'home') } : {}),
      XDG_CONFIG_HOME: configDir, XDG_DATA_HOME: join(temp, 'data'),
      XDG_CACHE_HOME: join(temp, 'cache'), OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_CONFIG_CONTENT: config, OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_SERVER_PASSWORD: pwd, WEBBRIDGE_PERSONAL_CDP_READONLY: '1',
      WEBBRIDGE_PERSONAL_BROWSER_OWNED: '1',
      WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://127.0.0.1:9333',
      WEBBRIDGE_G150_LOCAL_FIXTURE: '0' },
  });
  let log = '';
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (value) => { log = (log + value.toString()).slice(-2500); });
  }
  const base = 'http://127.0.0.1:' + bind;
  const headers = { Authorization: 'Basic ' +
    Buffer.from('opencode:' + pwd).toString('base64') };
  try {
    let active = false, inventory = 'none';
    for (let i = 0; i < 100 && server.exitCode === null; i++) {
      try {
        const reply = await fetch(base + '/api/plugin', {
          headers, signal: AbortSignal.timeout(650),
        });
        if (reply.ok) {
          const result = await reply.json();
          inventory = JSON.stringify(result.data?.filter((item) =>
            /webbridge|failed/i.test(item?.id ?? '')).map((item) =>
            ({ id: item.id, status: item.state?.status })));
          active = result.data?.some((item) =>
            item.id === 'opencode.webbridge' && item.state?.status === 'active') === true;
          if (active) break;
        }
      } catch { /* bounded startup retry */ }
      await new Promise((done) => setTimeout(done, 160));
    }
    assert.ok(active, 'official CLI did not load real raw tarball root, stage=' + stage +
      ' inventory=' + inventory + ' diagnostic=' +
      log.replaceAll(pwd, '[REDACTED]').slice(-600));
    const providers = await fetch(base + '/api/provider', {
      headers, signal: AbortSignal.timeout(3000),
    });
    assert.equal(providers.ok, true);
    assert.doesNotMatch(JSON.stringify(await providers.json()),
      /webbridge-(chatgpt|deepseek|gemini|qwen|mistral)/,
      'unproven commercial model was advertised');
  } finally {
    if (server.exitCode === null && WINDOWS && server.pid)
      spawnSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { windowsHide: true });
    else if (server.exitCode === null) server.kill();
    await Promise.race([new Promise((done) => server.once('close', done)),
      new Promise((done) => setTimeout(done, 2500))]);
  }
  return { version: pkg.version, rootHash: digest(main) };
}

test('G164 SOURCE-only npm pack without prepack is RED; production manifest is complete', async () => {
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './index.mjs');
  assert.equal(manifest.scripts.prepack, 'node scripts/g164-prepare-package.mjs');
  assert.ok(manifest.files.includes('index.mjs') && manifest.files.includes('dist/src/'));
  assert.equal(manifest.dependencies.playwright, '1.64.1');
  assert.equal(manifest.dependencies.effect, '4.0.1');
});

test('G164 RAW npm pack, official CLI 2.0.32, upgrade and rollback without dist staging',
  { skip: !NATIVE }, async () => {
    const cli = JSON.parse(await readFile(join(repo, 'node_modules/@opencode/cli/package.json')));
    assert.equal(cli.version, '2.0.32');
    const temp = await mkdtemp(join(tmpdir(), 'webbridge-g164-raw-'));
    try {
      const variant = await sourceVariant(temp);
      const red = await pack(variant, temp, '0.0.1', false);
      assert.ok(!red.meta.files.some((item) => item.path === 'dist/src/index.js'),
        'RED --ignore-scripts unexpectedly built source');
      const first = await pack(repo, temp, '0.0.0');
      packageContract(first.meta);
      const upgrade = await pack(variant, temp, '0.0.1');
      packageContract(upgrade.meta);
      const prefix = join(temp, 'installed-profile');
      let initialHash = '';
      for (const [stage, archive, version] of [
        ['initial', first.path, '0.0.0'],
        ['upgrade', upgrade.path, '0.0.1'],
        ['rollback', first.path, '0.0.0'],
      ]) {
        execNpm(['install', archive, '--prefix', prefix, '--ignore-scripts',
          '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], temp, 360_000);
        const proof = await nativeProof(prefix, temp, stage);
        assert.equal(proof.version, version, stage + ' did not install specified tarball');
        if (stage === 'initial') initialHash = proof.rootHash;
        if (stage === 'rollback') assert.equal(proof.rootHash, initialHash);
      }
    } finally { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });

test('G164 lifecycle: uninstall from the package keeps official sessions and frees temp resources',
  { skip: !NATIVE }, async () => {
    const cli = JSON.parse(await readFile(join(repo, 'node_modules/@opencode/cli/package.json')));
    assert.equal(cli.version, '2.0.32');
    const temp = await mkdtemp(join(tmpdir(), 'webbridge-g164-life-'));
    let removed = false;
    try {
      const green = await pack(repo, temp, '0.0.0');
      packageContract(green.meta);
      const prefix = join(temp, 'installed-profile');
      execNpm(['install', green.path, '--prefix', prefix, '--ignore-scripts',
        '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], temp, 360_000);
      const installed = join(prefix, 'node_modules', NAME);
      const title = 'webbridge lifecycle ' + randomBytes(4).toString('hex');
      const staleConfig = JSON.stringify({ plugins: [pathToFileURL(installed).href] });

      // A real official session is created while the installed raw root is active.
      const live = await spawnOfficialCLI(temp, 'life-active', staleConfig);
      let sessionID;
      try {
        await waitPluginActive(live);
        sessionID = await officialSession(live, title);
      } finally { await live.stop(); }

      // Uninstall the raw package from the disposable profile.
      execNpm(['uninstall', NAME, '--prefix', prefix, '--ignore-scripts',
        '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], temp, 360_000);
      await assert.rejects(lstat(installed), 'uninstalled package directory is still present');

      // Stale config still points at the removed package: the server must stay
      // healthy, never report webbridge active, and keep the session intact.
      const stale = await spawnOfficialCLI(temp, 'life-stale', staleConfig);
      try {
        await waitReady(stale);
        const items = await pluginInventory(stale);
        assert.ok(!items.some((item) => item.id === 'opencode.webbridge' &&
          item.state?.status === 'active'), 'removed package still reported active');
        await assertSessionIntact(stale, sessionID, title);
      } finally { await stale.stop(); }

      // Clean config without the plugin entry: nothing webbridge registered, session intact.
      const clean = await spawnOfficialCLI(temp, 'life-clean', JSON.stringify({ plugins: [] }));
      try {
        await waitReady(clean);
        const items = await pluginInventory(clean);
        assert.ok(!items.some((item) => item.id === 'opencode.webbridge'),
          'removed plugin is still registered');
        await assertSessionIntact(clean, sessionID, title);
      } finally { await clean.stop(); }

      // Temporary resources are removable once every official server is stopped.
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      removed = true;
      await assert.rejects(lstat(temp), 'temporary resources survived cleanup');
    } finally {
      if (!removed) await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
