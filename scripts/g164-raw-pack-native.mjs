/** G164: raw npm pack -> unmodified official CLI 2.0.32; no staged dist or app mutation. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'opencode-webbridge';
const NATIVE = process.platform === 'linux' && process.env.G164_OFFICIAL_CLI === '1';
const digest = (s) => createHash('sha256').update(s).digest('hex');
const execNpm = (args, cwd, timeout = 120_000) => {
  const result = spawnSync('npm', args, {
    cwd, env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
    encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  assert.equal(result.status, 0, 'npm ' + args[0] + ' failed: ' +
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
  for (const required of ['package.json', 'dist/src/index.js',
    'dist/src/index.d.ts', 'dist/src/runtime/g163-root-read.js',
    'dist/src/browser/explicit-cdp-read.js']) {
    assert.ok(paths.includes(required), 'raw tarball misses ' + required);
  }
  assert.ok(paths.every((path) => path === 'package.json' ||
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
  await cp(join(repo, 'tsconfig.pack.json'), join(work, 'tsconfig.pack.json'));
  await mkdir(join(work, 'scripts'));
  await cp(join(repo, 'scripts/g164-prepare-package.mjs'),
    join(work, 'scripts/g164-prepare-package.mjs'));
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  manifest.version = '0.0.1';
  await writeFile(join(work, 'package.json'), JSON.stringify(manifest) + '\n');
  await symlink(join(repo, 'node_modules'), join(work, 'node_modules'), 'dir');
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
async function nativeProof(prefix, temp, stage) {
  const installed = join(prefix, 'node_modules', NAME);
  const pkg = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const main = await readFile(join(installed, 'dist/src/index.js'));
  assert.equal(pkg.main, './dist/src/index.js');
  assert.equal((await import(pathToFileURL(join(installed, 'dist/src/index.js')).href +
    '?g164=' + stage)).default.id, 'opencode.webbridge');
  // Version metadata changes, not the actual root entrypoint; rollback must restore bytes.
  const configDir = join(temp, 'config-' + stage);
  for (const dir of ['home', 'data', 'cache', 'config-' + stage])
    await mkdir(join(temp, dir), { recursive: true });
  const config = JSON.stringify({ plugins: [pathToFileURL(installed).href] });
  await writeFile(join(configDir, 'opencode.json'), config);
  const pwd = randomBytes(32).toString('hex');
  const bind = await port();
  const bin = join(repo, 'node_modules/.bin/opencode');
  const server = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(bind)], {
    cwd: temp, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: join(temp, 'home'),
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
    if (server.exitCode === null) server.kill();
    await Promise.race([new Promise((done) => server.once('close', done)),
      new Promise((done) => setTimeout(done, 2500))]);
  }
  return { version: pkg.version, rootHash: digest(main) };
}

test('G164 SOURCE-only npm pack without prepack is RED; production manifest is complete', async () => {
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './dist/src/index.js');
  assert.equal(manifest.scripts.prepack, 'node scripts/g164-prepare-package.mjs');
  assert.deepEqual(manifest.files.slice(0, 1), ['dist/src/']);
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
          '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], temp, 120_000);
        const proof = await nativeProof(prefix, temp, stage);
        assert.equal(proof.version, version, stage + ' did not install specified tarball');
        if (stage === 'initial') initialHash = proof.rootHash;
        if (stage === 'rollback') assert.equal(proof.rootHash, initialHash);
      }
    } finally { await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
