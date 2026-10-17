/** G119 integration provenance gate; executable, read-only, no app or browser spawn. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN = '4617210822bdbb31e5749751afbfb4584ccedac8';
export const G106 = 'aaefcf8c0ef2776ba6bd62a587eafbe749f18b30';
export const G113 = 'e1a04479876fcb469309cbbb9526639964bf35e3';
export const ARTIFACT = 'docs/patches/opencode-v2-4617210-browser-plugin-capability.patch';
export const EXPECTED = Object.freeze({
  [ARTIFACT]: 'fe5ae887ca3feb1c2a2e170a12b7a9c89e79684e80ee5ce656c7377604f753e8',
  'scripts/smoke-combined-page.mjs': '9e7aff83bd420645a6e66f5e898b4c219186ceda412c3dac446892cfe48bcf74',
  'fixtures/g97-combined-preview.mjs': '6a43f437cdfed073ca8289cc6a0c000ad05c6df5e70e1c3f51e79a9df8a2fc5b',
  'scripts/offline-rpc-package.mjs': 'e36110616ccd14bf31753e50473ee9a3e663e9a9e9e92c096c17c24c199ed241',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function inspect(files) {
  for (const [path, hash] of Object.entries(EXPECTED)) {
    const body = files[path];
    if (!Buffer.isBuffer(body) || digest(body) !== hash)
      throw new Error('G119 exact G106 patch / G113 executable fixture mismatch: ' + path);
  }
  const patch = files[ARTIFACT].toString('utf8');
  if (!patch.includes('diff --git a/packages/core/') ||
    !patch.includes('diff --git a/packages/plugin-browser/') ||
    !patch.includes('browserPolicy?.()') ||
    !patch.includes('a saved-rule epoch change while browser.tabs.list permission awaits') ||
    !patch.includes('saved-rule revision during asynchronous Desktop tab inventory') ||
    !patch.includes('real saved-rule mutation invalidates an already consumed native read')) {
    throw new Error('G119 missing G106 executable native-policy revision regressions');
  }
  const model = files['scripts/smoke-combined-page.mjs'].toString('utf8');
  if (!model.includes("scenario === 'browser-disconnect'") ||
    !model.includes('browser.page.close()') ||
    !model.includes('G100 combined native Chromium tab-change uncertainty PASS') ||
    !model.includes('WEBBRIDGE_G113_PAGE_CLOSE')) {
    throw new Error('G119 missing G100/G113 executable local Chromium fault scenario');
  }
  const plugin = files['fixtures/g97-combined-preview.mjs'].toString('utf8');
  if (!plugin.includes("id: 'webbridge-g99-page'") ||
    !plugin.includes('ctx.provider.transform') || !plugin.includes('ctx.rpc.register')) {
    throw new Error('G119 lost the installed combined RPC + model plugin contract');
  }
  return { source: PIN, policyPatch: G106, localPage: G113, patchSha256: EXPECTED[ARTIFACT],
    installedPluginPreserved: true, desktopElectronProof: false, commercialProviders: 0,
    browserWritesEnabled: false };
}

export async function verify(rootDir = root) {
  const entries = await Promise.all(Object.keys(EXPECTED).map(async (name) =>
    [name, await readFile(join(rootDir, name))]));
  return inspect(Object.fromEntries(entries));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verify().then((result) => console.log('G119 cross-stream artifact PROVENANCE PASS',
    JSON.stringify(result))).catch((error) => {
    console.error('G119 cross-stream artifact PROVENANCE FAIL:', error.message);
    process.exitCode = 1;
  });
}
