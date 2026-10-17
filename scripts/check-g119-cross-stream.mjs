/** G119 integration provenance gate; executable, read-only, no app or browser spawn. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN = '4617210822bdbb31e5749751afbfb4584ccedac8';
export const G106 = 'aaefcf8c0ef2776ba6bd62a587eafbe749f18b30';
export const G126 = '30ead17b53b7f8f742fed3a69e98d64f28f2f477';
export const G113 = 'e1a04479876fcb469309cbbb9526639964bf35e3';
export const ARTIFACT = 'docs/patches/opencode-v2-4617210-browser-plugin-capability.patch';
export const EXPECTED = Object.freeze({
  [ARTIFACT]: '1f6a0137f29fc074eaf67b09c85b50c9d544b809b98463a167c324189e2e1f27',
  // G125 extends the same G113 executable local browser test with durable-session checks.
  'scripts/smoke-combined-page.mjs': 'f2340ffb72f1fbf3174d806b12d337fb4f0ac389ad971fb9cf252272377ba431',
  'fixtures/g97-combined-preview.mjs': '474d653b41c54c840125b04488ceb975022935ef409eb911cfa7f5a6481c5468',
  'scripts/offline-rpc-package.mjs': '65f5852028e85f8e1ea007030df5a07cfe872b5e691a0a4c7eedea6fa4142e6a',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Git for Windows may check out the pre-existing G113 *.mjs files in CRLF,
// while hosted Linux checks out LF. Canonicalize ONLY fixture text. The G126
// security patch is hashed as exact bytes, without altering its vetted SHA.
const fixtureDigest = (bytes) => digest(Buffer.from(
  bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8'));

export function inspect(files) {
  for (const [path, hash] of Object.entries(EXPECTED)) {
    const body = files[path];
    if (!Buffer.isBuffer(body) ||
      (path === ARTIFACT ? digest(body) : fixtureDigest(body)) !== hash)
      throw new Error('G129 exact G126 patch / G125 executable fixture mismatch: ' + path);
  }
  const patch = files[ARTIFACT].toString('utf8');
  if (!patch.includes('diff --git a/packages/core/') ||
    !patch.includes('diff --git a/packages/plugin-browser/') ||
    !patch.includes('browserPolicy?.()') ||
    !patch.includes('a saved-rule epoch change while browser.tabs.list permission awaits') ||
    !patch.includes('saved-rule revision during asynchronous Desktop tab inventory') ||
    !patch.includes('real saved-rule mutation invalidates an already consumed native read') ||
    !patch.includes('browser-rpc-provenance.test.ts') ||
    !patch.includes('No verified Desktop transport for browser attach.') ||
    !patch.includes('Built-in browser RPC registration requires trusted plugin provenance')) {
    throw new Error('G129 missing G106 policy and G126 native first-attach/RPC provenance regressions');
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
  return { source: PIN, policyPatch: G126, precedingPolicyPatch: G106, localPage: G113, patchSha256: EXPECTED[ARTIFACT],
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
