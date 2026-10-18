/** Public official Desktop 2.0.32 capability probe; never execute another release as 2.0.32. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { loadOfficial, proveOfficialPublicApi } from './probe-d01d02-desktop-public-api.mjs';

export const OFFICIAL_TAG = 'v2.0.32';
export const OFFICIAL_SHA = '843a6c514e606b436a7fe713422ace0a93ad3d61';
const REPO = 'https://api.github.com/repos/anomalyco/opencode';
const names = Object.freeze([
  'opencode-desktop-linux-amd64.deb',
  'opencode-desktop-linux-x86_64.AppImage',
  'opencode-desktop-win-x64.exe',
]);
const headers = { Accept: 'application/vnd.github+json',
  'User-Agent': 'webbridge-g174-public-desktop-probe' };
const reject = (message) => { throw new Error('G174 official Desktop boundary: ' + message); };

/** A missing release is a definite negative; auth/rate-limit errors are UNKNOWN, not absent. */
export async function inspectRelease(fetcher = fetch) {
  const response = await fetcher(REPO + '/releases/tags/' + OFFICIAL_TAG,
    { headers, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return Object.freeze({
    status: 'NO_GO_OFFICIAL_DESKTOP_RELEASE_ABSENT', tag: OFFICIAL_TAG, assets: 0,
  });
  if (response.status !== 200) return reject('release query inconclusive HTTP ' + response.status);
  const release = await response.json();
  if (release?.tag_name !== OFFICIAL_TAG || !Array.isArray(release.assets) ||
      release.assets.length > 250) return reject('release tag/payload mismatch');
  const matching = release.assets.filter((asset) => names.includes(asset?.name));
  if (matching.length === 0) return Object.freeze({
    status: 'NO_GO_OFFICIAL_DESKTOP_BINARY_ABSENT', tag: OFFICIAL_TAG, assets: release.assets.length,
  });
  for (const asset of matching) {
    const url = 'https://github.com/anomalyco/opencode/releases/download/' +
      OFFICIAL_TAG + '/' + asset.name;
    if (asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) ||
        asset.size < 1_000_000 || asset.size > 400_000_000 ||
        !/^sha256:[0-9a-f]{64}$/.test(asset.digest ?? ''))
      return reject('unverifiable official Desktop binary metadata');
  }
  // A verified public binary now requires an actual GUI/IPC end-to-end. No false green.
  return Object.freeze({ status: 'DESKTOP_BINARY_REQUIRES_REAL_EXECUTION',
    tag: OFFICIAL_TAG, assets: matching.map(({ name, digest, size }) => ({ name, digest, size })) });
}

export async function inspectTag(fetcher = fetch) {
  const response = await fetcher(REPO + '/git/ref/tags/' + OFFICIAL_TAG,
    { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return reject('official source tag unavailable HTTP ' + response.status);
  const tag = await response.json();
  if (tag?.ref !== 'refs/tags/' + OFFICIAL_TAG || tag.object?.sha !== OFFICIAL_SHA)
    return reject('official Desktop source tag was moved');
  return true;
}

test('G174 actual official tag and pinned packaged IPC guard, not simulated Electron', {
  skip: process.env.G174_LIVE_DESKTOP !== '1',
}, async () => {
  await inspectTag();
  const sources = await loadOfficial();
  const boundary = await proveOfficialPublicApi(sources);
  assert.equal(boundary.tag, OFFICIAL_SHA);
  assert.equal(boundary.status, 'NO_GO_PACKAGED_GUI_EXTENSION');
  assert.equal(boundary.packagedManagerCalls, 0);
  assert.equal(boundary.serverPluginRenderer, false);
  assert.equal(boundary.nativeDesktopExecuted, false);
  const released = await inspectRelease();
  // This run is only allowed to pass when a real 2.0.32 Desktop is NOT obtainable.
  // When available, fail until the actual binary is run in a safe disposable profile.
  if (released.status === 'DESKTOP_BINARY_REQUIRES_REAL_EXECUTION')
    reject('exact official 2.0.32 binary became available: executable E2E required');
  assert.match(released.status, /^NO_GO_/);
  console.log('G174 official Desktop 2.0.32 evidence:', JSON.stringify({
    ...released, sourceSha: OFFICIAL_SHA, packagedGuiExtensionInstall: false,
    officialDesktopElectronExecuted: false, officialCliProductProofIsDesktop: false,
  }));
});
