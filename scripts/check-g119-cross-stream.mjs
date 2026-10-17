/** G119 integration provenance gate; executable, read-only, no app or browser spawn. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PIN = '4617210822bdbb31e5749751afbfb4584ccedac8';
export const G106 = 'aaefcf8c0ef2776ba6bd62a587eafbe749f18b30';
export const G126 = '30ead17b53b7f8f742fed3a69e98d64f28f2f477';
export const G131 = 'eafcc3ae05b7c4cbabfb163675d9731a92489dd2';
export const G113 = 'e1a04479876fcb469309cbbb9526639964bf35e3';
export const ARTIFACT = 'docs/patches/opencode-v2-4617210-browser-plugin-capability.patch';
export const EXPECTED = Object.freeze({
  [ARTIFACT]: '77b5ff872f5f3d1eb641896ad16fc6c50d8f21ad54bfa797d7519f1990a0685f',
  // G130 extends G125's exact G113 browser fixture with a G127 encrypted ACK sink.
  'scripts/smoke-combined-page.mjs': 'c7b2b6e2e90e1fe6b8a344e850ed4abe756d0f133697841346afac5920c66e67',
  'fixtures/g97-combined-preview.mjs': '474d653b41c54c840125b04488ceb975022935ef409eb911cfa7f5a6481c5468',
  'scripts/offline-rpc-package.mjs': '65f5852028e85f8e1ea007030df5a07cfe872b5e691a0a4c7eedea6fa4142e6a',
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Git for Windows may check out the pre-existing G113 *.mjs files in CRLF,
// while hosted Linux checks out LF. Canonicalize ONLY fixture text. The G131
// security patch is hashed as exact bytes, without altering its vetted SHA.
const fixtureDigest = (bytes) => digest(Buffer.from(
  bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8'));

export function inspect(files) {
  for (const [path, hash] of Object.entries(EXPECTED)) {
    const body = files[path];
    if (!Buffer.isBuffer(body) ||
      (path === ARTIFACT ? digest(body) : fixtureDigest(body)) !== hash)
      throw new Error('G132 exact G131 patch / G130 inherited fixture mismatch: ' + path);
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
    !patch.includes('Built-in browser RPC registration requires trusted plugin provenance') ||
    !patch.includes('Stale browser tab generation.') ||
    !patch.includes('read.consumed = true') ||
    !patch.includes('tab.generation === read.generation && tab.url === read.url') ||
    !patch.includes('an out-of-order state cannot resurrect a pending read from a replaced document') ||
    !patch.includes('a read.live receipt cannot be resurrected after an intervening tab replacement') ||
    !patch.includes('URL change at unchanged generation burns an already-committed read')) {
    throw new Error('G132 missing G106/G126/G131 native provenance or read finality regressions');
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
  return { source: PIN, policyPatch: G131, precedingPolicyPatch: G126, precedingPolicyBase: G106, localPage: G113, patchSha256: EXPECTED[ARTIFACT],
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
