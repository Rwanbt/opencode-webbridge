/** G149 genuine CLI 2.0.32 turn triggers host read tool before host ACK/SSE. */
import { strict as assert } from 'node:assert';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { proveG125 } from './smoke-g125-v2032.mjs';
import { createG149VerticalHost } from './g149-vertical-host.mjs';
import { runPageProof as runG149Page } from './g149-combined-page.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function proveG149({
  openPage, openBrowser, receiptFactory = createG149VerticalHost,
} = {}) {
  const result = await proveG125({
    openPage, openBrowser, receiptFactory,
    runPage: runG149Page,
  });
  assert.equal(result.readAckReceipts?.length, 6);
  assert.ok(result.readAckReceipts.every((item) =>
    item.nativeSessionBound && item.readonlyToolConfirmed &&
    item.reusedAfterRestart === false && item.encrypted &&
    item.lostAckReconciled && item.wrongScopeDenied));
  assert.deepEqual(result.readAckReceipts.map((item) => item.terminal),
    ['finished','finished','cancelled','finished','finished','cancelled']);
  return { actualOfficialCLI: '2.0.32', chromiumLocal: true,
    toolInNativeTurn: true, durablePreSseReceipt: true,
    realFilesystemRead: true, durableNoReplay: true,
    osAuthorityProven: false, desktopElectronProven: false,
    providersCommercialOperational: 0, browserWritesEnabled: false };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux') throw new Error('G149 chromium fixture is Linux CI only');
    const { openLocalChatPage } = await import(pathToFileURL(
      join(root, 'dist/src/testing/local-chat-page.js')).href);
    const { openLocalBrowserCompanion } = await import(pathToFileURL(
      join(root, 'dist/src/testing/local-browser-companion.js')).href);
    console.log('G149 integrated official CLI read-only turn PASS',
      JSON.stringify(await proveG149({ openPage: openLocalChatPage, openBrowser: openLocalBrowserCompanion })));
  } catch (error) {
    console.error('G149 integrated official CLI turn NO-GO', String(error));
    process.exitCode = 1;
  }
}
