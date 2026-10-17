/** G92: read-only OFFICIAL Desktop gate. Never launches Electron or a CLI. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { freemem, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_FREE_BYTES = 6 * 1024 ** 3;
export const DESKTOP_VERSION = '2.0.32';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Fail closed; both physical memory and *all* existing OpenCode Desktop processes matter. */
export function decision({ platform, freeBytes, snapshot }) {
  const reasons = [];
  if (platform !== 'win32') reasons.push('official-installed-desktop-requires-Windows');
  if (!Number.isSafeInteger(freeBytes) || freeBytes < MIN_FREE_BYTES)
    reasons.push('free-memory-below-6-GiB-or-unknown');
  if (snapshot) {
    if (!Number.isSafeInteger(snapshot.running) || snapshot.running !== 0)
      reasons.push('OpenCode-Desktop-running-or-unknown');
    if (!snapshot.desktop || !snapshot.cli || !snapshot.marker || !snapshot.installPathSafe)
      reasons.push('official-installed-pair-missing-or-unsafe');
    if (snapshot.version !== DESKTOP_VERSION || snapshot.marker !== DESKTOP_VERSION)
      reasons.push('installed-Desktop-CLI-version-mismatch');
    if (!snapshot.signedDesktop || !snapshot.signedCLI || !snapshot.sameSigner)
      reasons.push('official-Authenticode-signature-invalid');
  } else if (!reasons.length) reasons.push('installed-binary-probe-unavailable');
  return Object.freeze({
    status: reasons.length ? 'SKIP_UNSAFE' : 'REVIEW_ONLY',
    desktopExecuted: false,
    proof: 'NO_ELECTRON_E2E',
    reasons,
  });
}

/** No subprocess is started when RAM is below threshold or platform is wrong. */
export function preflight({ platform = process.platform, freeBytes = freemem(),
  inspect = inspectOfficialInstall } = {}) {
  const first = decision({ platform, freeBytes });
  if (first.reasons.includes('free-memory-below-6-GiB-or-unknown') ||
    first.reasons.includes('official-installed-desktop-requires-Windows')) return first;
  try { return decision({ platform, freeBytes, snapshot: inspect() }); }
  catch { return decision({ platform, freeBytes, snapshot: undefined }); }
}

function inspectOfficialInstall() {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$base=Join-Path $env:LOCALAPPDATA 'Programs/OpenCode'",
    "$exe=Join-Path $base 'OpenCode.exe'",
    "$cli=Join-Path $base 'resources/opencode-cli.exe'",
    "$marker=Join-Path $base 'resources/opencode-cli.version'",
    "$ok=(Test-Path -LiteralPath $exe -PathType Leaf) -and (Test-Path -LiteralPath $cli -PathType Leaf)",
    "$version=if($ok){(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion}else{''}",
    "$mark=if(Test-Path -LiteralPath $marker){(Get-Content -LiteralPath $marker -Raw).Trim()}else{''}",
    "$a=if($ok){Get-AuthenticodeSignature -LiteralPath $exe}else{$null}",
    "$b=if($ok){Get-AuthenticodeSignature -LiteralPath $cli}else{$null}",
    "$reparse=$false; if($ok){foreach($file in @($base,(Join-Path $base 'resources'),$exe,$cli,$marker)){if((Test-Path -LiteralPath $file) -and (((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){$reparse=$true}}}",
    "$count=@(Get-Process -Name OpenCode -ErrorAction SilentlyContinue).Count",
    "[pscustomobject]@{running=$count;desktop=(Test-Path -LiteralPath $exe -PathType Leaf);cli=(Test-Path -LiteralPath $cli -PathType Leaf);marker=$mark;version=($version -replace '\\.0$','');installPathSafe=(-not $reparse);signedDesktop=($a -and $a.Status -eq 'Valid' -and $a.SignerCertificate.Subject -like '*Anomaly Innovations*');signedCLI=($b -and $b.Status -eq 'Valid' -and $b.SignerCertificate.Subject -like '*Anomaly Innovations*');sameSigner=($a -and $b -and $a.SignerCertificate.Thumbprint -eq $b.SignerCertificate.Thumbprint)} | ConvertTo-Json -Compress",
  ].join('; ');
  const env = Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR',
    'COMSPEC', 'LOCALAPPDATA'].filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]));
  const run = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive',
    '-Command', script], {
    windowsHide: true, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 4096,
  });
  if (run.error || run.status !== 0) throw new Error('read-only Windows probe unavailable');
  return JSON.parse(run.stdout);
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith('..\\') &&
    !rel.startsWith('../') && !isAbsolute(rel);
}

/** A test-only payload staging rehearsal; callback cannot choose profile destination. */
export async function withDisposableProfile(callback, inherited = process.env) {
  const temp = await mkdtemp(join(tmpdir(), 'g92-desktop-isolation-'));
  const sandbox = resolve(temp);
  const safe = inside(resolve(tmpdir()), sandbox) && basename(sandbox).startsWith('g92-desktop-isolation-');
  const parts = ['home', 'appdata', 'localappdata', 'tmp', 'config', 'data',
    'state', 'cache', 'plugins'];
  try {
    if (!safe) throw new Error('unsafe disposable profile root');
    await Promise.all(parts.map((part) => mkdir(join(sandbox, part), { recursive: true })));
    const secret = randomBytes(32).toString('hex');
    const moduleDir = join(sandbox, 'plugins', 'g92-standalone-rpc');
    await mkdir(moduleDir);
    await copyFile(join(root, 'fixtures/g81-rpc-preview.mjs'), join(moduleDir, 'index.mjs'));
    await writeFile(join(moduleDir, 'package.json'), JSON.stringify({
      name: 'g92-test-only-rpc', version: '0.0.0', type: 'module', main: 'index.mjs',
    }));
    const config = { plugins: [pathToFileURL(moduleDir).href] };
    await writeFile(join(sandbox, 'config', 'opencode.json'), JSON.stringify(config));
    const allow = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC'];
    const env = Object.fromEntries(allow.filter((name) => inherited[name] !== undefined)
      .map((name) => [name, inherited[name]]));
    Object.assign(env, {
      HOME: join(sandbox, 'home'), USERPROFILE: join(sandbox, 'home'),
      APPDATA: join(sandbox, 'appdata'), LOCALAPPDATA: join(sandbox, 'localappdata'),
      TMP: join(sandbox, 'tmp'), TEMP: join(sandbox, 'tmp'), TMPDIR: join(sandbox, 'tmp'),
      XDG_CONFIG_HOME: join(sandbox, 'config'), XDG_DATA_HOME: join(sandbox, 'data'),
      XDG_CACHE_HOME: join(sandbox, 'cache'), XDG_STATE_HOME: join(sandbox, 'state'),
      OPENCODE_CONFIG_DIR: join(sandbox, 'config'),
      OPENCODE_DB: join(sandbox, 'data', 'opencode.db'),
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      WEBBRIDGE_G81_TEST_ONLY: '1', WEBBRIDGE_G81_SECRET: secret,
      HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9',
      NO_PROXY: '127.0.0.1,localhost',
    });
    if (!Object.values(env).every((value) => typeof value === 'string'))
      throw new Error('unsafe environment value');
    return await callback({ sandbox, env, moduleDir, config });
  } finally {
    // This exact directory was created by mkdtemp above, never provided by caller.
    if (safe)
      await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = preflight();
  // Even REVIEW_ONLY does not launch: packaged 2.0.32 profile isolation is unproven.
  console.log('G92 OFFICIAL DESKTOP NOT RUN', JSON.stringify(check));
}
