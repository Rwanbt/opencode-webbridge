/** Product-positive counterpart to Desktop NO-GO: official CLI 2.0.32 raw .tgz, no staging. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function npm(args, cwd) {
  const proc = spawnSync('npm', args, { cwd, encoding: 'utf8',
    timeout: 120_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' } });
  assert.equal(proc.status, 0, 'isolated npm ' + args[0] + ': ' + (proc.stderr ?? '').slice(-600));
  return JSON.parse(proc.stdout.slice(proc.stdout.indexOf('[')));
}
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
test('G174 raw root tarball loads in official CLI2.0.32; provider surface read without Desktop claim', {
  skip: process.platform !== 'linux' || process.env.G174_NATIVE_CLI !== '1',
}, async () => {
  const cli = JSON.parse(await readFile(join(root, 'node_modules/@opencode/cli/package.json')));
  assert.equal(cli.version, '2.0.32');
  const temp = await mkdtemp(join(tmpdir(), 'g174-product-'));
  let child;
  try {
    const [pack] = npm(['pack', root, '--json', '--pack-destination', temp], temp);
    assert.ok(pack.files.some((f) => f.path === 'dist/src/index.js'));
    assert.ok(pack.files.some((f) => f.path === 'index.mjs'));
    const profile = join(temp, 'installed');
    const command = spawnSync('npm', ['install', join(temp, pack.filename),
      '--prefix', profile, '--ignore-scripts', '--no-save', '--no-package-lock',
      '--no-audit', '--no-fund'], { cwd: temp, encoding: 'utf8', timeout: 120_000 });
    assert.equal(command.status, 0, (command.stderr ?? '').slice(-500));
    const installed = join(profile, 'node_modules/opencode-webbridge');
    const manifest = JSON.parse(await readFile(join(installed, 'package.json')));
    assert.equal(manifest.main, './index.mjs');
    assert.equal((await import(pathToFileURL(join(installed, 'index.mjs')).href)).default.id,
      'opencode.webbridge');
    const conf = join(temp, 'conf');
    await Promise.all([mkdir(conf), ...['home', 'cache', 'data'].map((name) =>
      mkdir(join(temp, name)))]);
    const ref = pathToFileURL(installed).href;
    const config = JSON.stringify({ plugins: [ref] });
    await writeFile(join(conf, 'opencode.json'), config);
    const password = randomBytes(32).toString('hex');
    const port = await freePort();
    const env = { ...process.env, HOME: join(temp, 'home'), XDG_CONFIG_HOME: conf,
      XDG_DATA_HOME: join(temp, 'data'), XDG_CACHE_HOME: join(temp, 'cache'),
      OPENCODE_CONFIG_DIR: conf, OPENCODE_CONFIG_CONTENT: config,
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_SERVER_PASSWORD: password,
      WEBBRIDGE_PERSONAL_CDP_READONLY: '1', WEBBRIDGE_PERSONAL_BROWSER_OWNED: '1',
      WEBBRIDGE_PERSONAL_CDP_ENDPOINT: 'http://127.0.0.1:9333' };
    const endpoint = 'http://127.0.0.1:' + port;
    const headers = { Authorization: 'Basic ' +
      Buffer.from('opencode:' + password).toString('base64') };
    child = spawn(join(root, 'node_modules/.bin/opencode'),
      ['serve', '--hostname', '127.0.0.1', '--port', String(port)],
      { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let logs = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-1600);
    });
    let loaded = false;
    for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt++) {
      try {
        const reply = await fetch(endpoint + '/api/plugin', {
          headers, signal: AbortSignal.timeout(700) });
        if (reply.ok) {
          const data = (await reply.json()).data;
          loaded = data?.some((item) => item.id === 'opencode.webbridge' &&
            item.state?.status === 'active') === true;
          if (loaded) break;
        }
      } catch { /* bounded startup check */ }
      await new Promise((done) => setTimeout(done, 150));
    }
    assert.ok(loaded, 'official CLI did not load tarball: ' +
      logs.replaceAll(password, '[REDACTED]'));
    const provider = await fetch(endpoint + '/api/provider', {
      headers, signal: AbortSignal.timeout(5000) });
    assert.equal(provider.status, 200);
    const surface = JSON.stringify(await provider.json());
    assert.doesNotMatch(surface, /webbridge-(chatgpt|deepseek|gemini|qwen|mistral)/);
    const pub = await fetch(endpoint + '/api/config', {
      headers, signal: AbortSignal.timeout(5000) });
    assert.equal(pub.ok, true);
    assert.match(JSON.stringify(await pub.json()), /opencode-webbridge/);
    console.log('G174 product-positive:', JSON.stringify({
      cli: '2.0.32', packageInstalled: true, pluginActive: true,
      providerSurfaceRead: true, commercialModelsAdvertised: 0,
      desktopElectronStarted: false, nativeGuiExtensionInstalled: false,
    }));
  } finally {
    if (child?.exitCode === null) child.kill();
    if (child) await Promise.race([new Promise((done) => child.once('close', done)),
      new Promise((done) => setTimeout(done, 2500))]);
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
