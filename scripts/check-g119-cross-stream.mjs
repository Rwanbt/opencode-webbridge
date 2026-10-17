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
  'scripts/smoke-combined-page.mjs': '8e4b3be8416f7e85445c9b3deeb75ba5418e60680485129c4dd5aabfdafda95d',
  'fixtures/g97-combined-preview.mjs': '474d653b41c54c840125b04488ceb975022935ef409eb911cfa7f5a6481c5468',
  'scripts/offline-rpc-package.mjs': 'dd0c96a561ade756bd09739d14c596de4525a4bb4ff6e219251e93050447abc5',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Git for Windows may check out the pre-existing G113 *.mjs files in CRLF,
// while hosted Linux checks out LF. Canonicalize ONLY fixture text. The G106
// security patch is hashed as exact bytes, without altering its vetted SHA.
const fixtureDigest = (bytes) => digest(Buffer.from(
  bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8'));

export function inspect(files) {
  for (const [path, hash] of Object.entries(EXPECTED)) {
    const body = files[path];
    if (!Buffer.isBuffer(body) ||
      (path === ARTIFACT ? digest(body) : fixtureDigest(body)) !== hash)
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
