/** Official Desktop 2.0.32 evidence gate. This module NEVER spawns Electron. */
import { createHash } from 'node:crypto';
import { freemem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const VERSION = '2.0.32';
export const TAG_SHA = '843a6c514e606b436a7fe713422ace0a93ad3d61';
export const MEMORY_FLOOR = 6 * 1024 ** 3;
export const SOURCE = Object.freeze({
  'packages/desktop/src/main/lifecycle/configure.ts':
    '5266fa414eebe9465f003944033db24d2463c5612d4ab3652f0f367390ce5d92',
  'packages/desktop/src/main/service/background-service.ts':
    '1bef14f2d49d8720a4a27e87297e4cd5d9c586df629f614caa6170760b77dbe7',
});
const FEED = 'https://opencode.ai/update/api/latest/desktop/opencode/latest-linux.yml';
const RAW = 'https://raw.githubusercontent.com/anomalyco/opencode/' + TAG_SHA + '/';
const APPIMAGE = 'opencode-desktop-linux-x86_64.AppImage';
const RELEASE = Object.freeze({
  sha512: 'v7bD3BJ478IFPkjbP25Wqgla1rqTJNX6RRlHef6Bp8ju+xHVpx6S78ZYBxSRWSuyFA5C8jRqmhBZ7Sn/zGnVZg==',
  size: 274268075,
  url: 'https://opencode.ai/files/bin/' + VERSION + '/' + APPIMAGE,
});
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Strictly parse the tiny official electron-updater manifest, not arbitrary YAML. */
export function parseFeed(value) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('oversized/unavailable release feed');
  const version = /^version:\s*(\S+)\s*$/m.exec(value)?.[1];
  const matches = [...value.matchAll(
    /^\s*- url:\s*(\S+)\s*\r?\n\s+sha512:\s*(\S+)\s*\r?\n\s+size:\s*(\d+)\s*$/gm)];
  if (!version || matches.length !== 3) throw new Error('release entries missing/ambiguous');
  const files = matches.map((match) => ({ url: match[1], sha512: match[2], size: Number(match[3]) }));
  if (new Set(files.map((f) => f.url)).size !== 3 ||
    files.some((f) => !/^https:\/\/opencode\.ai\/files\/bin\/\d+\.\d+\.\d+\/opencode-desktop-linux-(?:x86_64\.AppImage|amd64\.deb|x86_64\.rpm)$/.test(f.url) ||
      !/^[A-Za-z0-9+/]{86}==$/.test(f.sha512) || !Number.isSafeInteger(f.size) ||
      f.size < 100_000_000 || f.size > 500_000_000)) {
    throw new Error('unsafe release origin/hash/size');
  }
  return { version, files };
}

/** Pinned official source ONLY: inspect real packaged paths, not dev fixture flags. */
export function verifySource(source) {
  const paths = Object.keys(SOURCE);
  if (paths.some((path) => typeof source?.[path] !== 'string' ||
    sha256(source[path]) !== SOURCE[path])) throw new Error('official 2.0.32 source mismatch');
  const configure = source[paths[0]];
  const service = source[paths[1]];
  if (!/if\s*\(!app\.isPackaged\)\s*app\.commandLine\.appendSwitch\("remote-debugging-port"/.test(configure) ||
    !/app\.isPackaged\s*\?\s*undefined\s*:\s*process\.env\.OPENCODE_DESKTOP_TEST_ROOT/.test(configure) ||
    !/app\.setPath\("userData",\s*testRoot\s*\?/.test(configure) ||
    !/const isolated\s*=\s*!app\.isPackaged\s*&&\s*process\.env\.OPENCODE_DESKTOP_ISOLATED_SERVER/.test(service) ||
    !/const early\s*=\s*mode === "initial"\s*&&\s*!isolated\s*\?\s*yield\* Effect\.promise\(sidecarProbe\)/.test(service)) {
    throw new Error('packaged Desktop isolation/sidecar contract changed');
  }
  return { pinnedTag: TAG_SHA, sourceVerified: true, packagedDebugPort: false,
    packagedTestRoot: false, packagedIsolatedService: false, existingSidecarMayBeAdopted: true };
}

/**
 * Strict negative result, even with valid source and updater SHA512: the updater
 * metadata is NOT a signed publisher attestation; GUI selector is untested.
 */
export function assess({ source, feed, platform = process.platform, freeBytes = freemem(),
  desktopInstances = null } = {}) {
  const reasons = [];
  if (platform === 'win32' && (!Number.isSafeInteger(freeBytes) || freeBytes < MEMORY_FLOOR))
    reasons.push('WINDOWS_RAM_BELOW_6_GIB');
  if (platform === 'win32' && desktopInstances !== 0)
    reasons.push('DESKTOP_INSTANCES_PRESENT_OR_UNATTESTED');
  let official;
  try { official = verifySource(source); }
  catch { reasons.push('OFFICIAL_SOURCE_NOT_VERIFIED'); }
  let versionMatched = false;
  try {
    const manifest = parseFeed(feed);
    const image = manifest.files.find((item) => item.url.endsWith('/' + APPIMAGE));
    versionMatched = manifest.version === VERSION && image?.url === RELEASE.url &&
      image?.sha512 === RELEASE.sha512 && image?.size === RELEASE.size;
    if (!versionMatched) reasons.push('EXACT_RELEASE_MANIFEST_UNAVAILABLE_OR_CHANGED');
  } catch { reasons.push('RELEASE_MANIFEST_NOT_VERIFIED'); }
  if (official) reasons.push('PACKAGED_DEBUG_AND_TEST_ROOT_UNSUPPORTED',
    'PACKAGED_SERVICE_ADOPTION_UNCERTAIN');
  // The CDN's SHA512 protects transfer integrity, not an independent publisher signature.
  reasons.push('INDEPENDENT_LINUX_PUBLISHER_SIGNATURE_UNATTESTED',
    'PACKAGED_GUI_MODEL_PICKER_AND_PLUGIN_DISCOVERY_NOT_TESTED');
  return { status: 'SKIP_NO_ELECTRON_E2E', electronExecuted: false,
    signedArtifactVerified: false, guiModelTurnVerified: false,
    sourceVerified: Boolean(official), versionMatched, reasons };
}

export async function inspectLive(fetcher = fetch) {
  const paths = Object.keys(SOURCE);
  // Only immutable official source paths + the small updater metadata; no binary download.
  const urls = [...paths.map((path) => RAW + path), FEED];
  const records = await Promise.all(urls.map(async (url) => {
    const response = await fetcher(url, { signal: AbortSignal.timeout(7000),
      headers: { Accept: 'text/plain' } });
    if (!response.ok) throw new Error('official source/release read unavailable');
    const text = await response.text();
    if (text.length > 20_000) throw new Error('oversized official source/release');
    return text;
  }));
  return { source: Object.fromEntries(paths.map((path, index) => [path, records[index]])),
    feed: records[2] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await inspectLive().then(assess).catch(() => assess());
  console.log('G111 OFFICIAL DESKTOP NEVER LAUNCHED', JSON.stringify(result));
  // A safe skip is a successful preflight execution, NEVER an Electron pass.
  if (result.electronExecuted || result.guiModelTurnVerified) process.exitCode = 1;
}
