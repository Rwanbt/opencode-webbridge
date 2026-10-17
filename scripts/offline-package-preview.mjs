/** OFFLINE distribution experiment: npm tarball, isolated prefix, verified rollback. */
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const NAME = 'opencode-webbridge-offline-preview';
export const ID = 'opencode.webbridge.preview';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const signature = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entry = `// G76 offline preview only. No model, browser, hook or tool registration.\nexport default { id: "${ID}", setup() {} };\n`;

function npmCLI(args, env, cwd) {
  const cli = process.env.npm_execpath;
  if (!cli || !existsSync(cli) || !/npm-cli\.js$/i.test(cli)) {
    throw new Error('run from npm scripts with a pinned npm-cli.js; no system installer fallback');
  }
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 200_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`offline npm ${args[0]} failed: ${result.error?.code ?? result.status}; ${result.stderr?.slice(-600) ?? ''}`);
  }
  return result.stdout;
}

function isolatedEnvironment(temp) {
  const allow = process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PROCESSOR_ARCHITECTURE']
    : ['PATH', 'SHELL', 'LANG', 'LC_ALL'];
  const env = Object.fromEntries(allow.filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  return {
    ...env, HOME: join(temp, 'home'), USERPROFILE: join(temp, 'home'),
    APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'),
    TMP: join(temp, 'tmp'), TEMP: join(temp, 'tmp'), TMPDIR: join(temp, 'tmp'),
    XDG_CONFIG_HOME: join(temp, 'xdg-config'), XDG_DATA_HOME: join(temp, 'xdg-data'),
    XDG_CACHE_HOME: join(temp, 'xdg-cache'), XDG_STATE_HOME: join(temp, 'xdg-state'),
    npm_config_cache: join(temp, 'npm-cache'),
    npm_config_userconfig: join(temp, 'blank.npmrc'),
    npm_config_globalconfig: join(temp, 'blank-global.npmrc'),
    npm_config_audit: 'false', npm_config_fund: 'false',
    npm_config_update_notifier: 'false', npm_config_offline: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  };
}

async function pack(temp, version, label, env) {
  const directory = join(temp, `src-${version}-${label}`);
  const destination = join(temp, `archives-${label}`);
  await Promise.all([mkdir(directory), mkdir(destination)]);
  const manifest = { name: NAME, version, type: 'module', main: 'index.mjs',
    files: ['index.mjs'], description: 'INERT OFFLINE TEST PREVIEW. Not a commercial provider.' };
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest) + '\n');
  await writeFile(join(directory, 'index.mjs'), entry);
  const output = npmCLI(['pack', directory, '--pack-destination', destination,
    '--offline', '--ignore-scripts', '--json'], env, temp);
  const [meta] = JSON.parse(output);
  if (meta.name !== NAME || meta.version !== version ||
    meta.files.length !== 2 || meta.files.some((file) => !['index.mjs', 'package.json'].includes(file.path))) {
    throw new Error('preview archive contains unexpected files');
  }
  const tarball = join(destination, meta.filename);
  const hash = signature(await readFile(tarball));
  const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`;
  if (integrity !== meta.integrity) throw new Error('npm archive integrity mismatch');
  return { tarball, hash, version };
}

async function installed(prefix) {
  const base = join(prefix, 'node_modules', NAME);
  const manifest = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
  const module = await import(pathToFileURL(join(base, 'index.mjs')).href + `?check=${manifest.version}`);
  if (manifest.name !== NAME || module.default?.id !== ID ||
    typeof module.default.setup !== 'function' || await readFile(join(base, 'index.mjs'), 'utf8') !== entry) {
    throw new Error('preview installed unexpected or activated entrypoint');
  }
  return manifest.version;
}

async function install(item, expectedHash, env, temp, prefix) {
  if (signature(await readFile(item.tarball)) !== expectedHash) {
    throw new Error('package SHA256 mismatch: refusing installation');
  }
  npmCLI(['install', item.tarball, '--prefix', prefix, '--offline', '--ignore-scripts',
    '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], env, temp);
  if (await installed(prefix) !== item.version) throw new Error('installed package version mismatch');
}

async function nativeSmoke(profile, env, temp, bin) {
  if (!bin) throw new Error('native CLI path required for explicit smoke');
  const configDir = join(temp, 'native-config');
  await mkdir(configDir);
  const pluginDir = join(profile, 'node_modules', NAME);
  const config = JSON.stringify({ plugins: [pathToFileURL(pluginDir).href] });
  await writeFile(join(configDir, 'opencode.json'), config);
  const sandbox = { ...env, OPENCODE_CONFIG_DIR: configDir, OPENCODE_CONFIG_CONTENT: config };
  const socket = createServer();
  await new Promise((ok, fail) => { socket.once('error', fail); socket.listen(0, '127.0.0.1', ok); });
  const port = socket.address().port;
  await new Promise((ok) => socket.close(ok));
  const child = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: temp, env: sandbox, windowsHide: true, stdio: 'ignore',
    shell: process.platform === 'win32' && /\.cmd$/i.test(bin),
  });
  try {
    let registered = false;
    for (let i = 0; i < 80 && child.exitCode === null; i++) {
      try {
        const result = await fetch(`http://127.0.0.1:${port}/api/plugin`, {
          signal: AbortSignal.timeout(500),
        });
        if (result.ok) {
          const ids = await result.json();
          if (JSON.stringify(ids).includes(ID)) { registered = true; break; }
          throw new Error('native OpenCode did not register packaged preview');
        }
      } catch (err) {
        if (err.message?.includes('did not register')) throw err;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!registered) throw new Error('native OpenCode v2 packaged preview load timed out');
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([new Promise((ok) => child.once('close', ok)),
      new Promise((ok) => setTimeout(ok, 3_000))]);
  }
}

/** Creates and cleans its OWN temporary sandbox. Never accepts a user/global install target. */
export async function exercisePreview({ nativeBin } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'webbridge-g76-package-'));
  const env = isolatedEnvironment(temp);
  try {
    await Promise.all(['home', 'tmp', 'appdata', 'localappdata'].map((folder) =>
      mkdir(join(temp, folder))));
    await writeFile(join(temp, 'blank.npmrc'), '');
    await writeFile(join(temp, 'blank-global.npmrc'), '');
    const a = await pack(temp, '0.0.1', 'a', env);
    const same = await pack(temp, '0.0.1', 'repeat', env);
    if (a.hash !== same.hash) throw new Error('offline package is not byte reproducible');
    const b = await pack(temp, '0.0.2', 'upgrade', env);
    if (a.hash === b.hash) throw new Error('upgrade archive hash did not change');
    const profile = join(temp, 'clean-profile');
    await mkdir(profile);
    await install(a, a.hash, env, temp, profile);
    await install(b, b.hash, env, temp, profile);
    // Deliberately tamper an archive to prove mismatch rejects before npm sees it.
    const corrupt = join(temp, 'tampered.tgz');
    await copyFile(a.tarball, corrupt);
    await writeFile(corrupt, Buffer.concat([await readFile(corrupt), Buffer.from('tampered')]));
    let refused = false;
    try { await install({ ...a, tarball: corrupt }, a.hash, env, temp, profile); }
    catch (err) { if (!/SHA256 mismatch/.test(String(err))) throw err; refused = true; }
    if (!refused || await installed(profile) !== '0.0.2') throw new Error('tampered upgrade modified profile');
    await install(a, a.hash, env, temp, profile);
    if (nativeBin) await nativeSmoke(profile, env, temp, nativeBin);
    npmCLI(['uninstall', NAME, '--prefix', profile, '--offline', '--ignore-scripts',
      '--no-save', '--no-package-lock', '--no-audit', '--no-fund'], env, temp);
    if (existsSync(join(profile, 'node_modules', NAME))) throw new Error('uninstall left preview plugin installed');
    return { digest: a.hash, upgraded: true, rolledBack: true, tamperDenied: true,
      uninstalled: true, native: Boolean(nativeBin) };
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const native = process.argv.includes('--native');
  // Explicit native check may use only the repository-local CLI installed in CI.
  const localCLI = resolve(root, 'node_modules', '.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  if (native && !existsSync(localCLI)) throw new Error('pinned repository-local OpenCode CLI unavailable');
  exercisePreview({ nativeBin: native ? localCLI : undefined })
    .then((result) => console.log('G76 offline package preview PASS', JSON.stringify(result)))
    .catch((err) => { console.error('G76 offline package preview FAILED:', err.message); process.exitCode = 1; });
}
