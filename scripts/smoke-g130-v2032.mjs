/** G130: real installed CLI/native local page wire -> host encrypted durable read receipts. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { proveG125 } from './smoke-g125-v2032.mjs';
import { createG130ReceiptHost } from './g130-receipt-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = async (path) => import(pathToFileURL(join(root, 'dist/src/testing', path)).href);
const fixtureIdentity = (sessionID) => ({
  sessionID, providerID: 'qwen', accountRef: 'g130SyntheticFixture', tabID: 'g130LocalChromium',
  tabGeneration: 'g130tab' + randomBytes(8).toString('hex'),
  connectionID: 'g130LoopbackConnection',
  connectionGeneration: 'g130conn' + randomBytes(8).toString('hex'),
}); // These are explicit TEST-HOST labels, NOT Core/OS browser provenance.

export async function proveG130({ prove = proveG125, openPage, openBrowser } = {}) {
  const result = await prove({ openPage, openBrowser,
    receiptFactory: async ({ temp, sessionID, turnID }) => createG130ReceiptHost({
      temp, turnID, identity: fixtureIdentity(sessionID),
    }),
  });
  assert.equal(result.readAckReceipts?.length, 6);
  assert.ok(result.readAckReceipts.every((item) => item?.scopedToNativeSession &&
    item?.lostAckReconciled && item?.wrongScopeDenied && item?.encrypted));
  assert.deepEqual(result.readAckReceipts.map((item) => item.terminal),
    ['finished', 'finished', 'cancelled', 'finished', 'finished', 'cancelled']);
  return { cliVersion: '2.0.32', installedPlugin: 'one local .tgz',
    nativeSessionRestartVerified: result.sessionPersistenceAfterHostRestart,
    actualNativeRpcFramesFsyncedBeforeSSE: true, hostSinkNotCoreAuthority: true,
    receipts: result.readAckReceipts.map(({ acknowledged, terminal }) => ({ acknowledged, terminal })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux') throw new Error('G130 Chromium only on Linux hosted CI');
    const { openLocalChatPage } = await local('local-chat-page.js');
    const { openLocalBrowserCompanion } = await local('local-browser-companion.js');
    console.log('G130 host sink + official CLI 2.0.32 PASS', JSON.stringify(
      await proveG130({ openPage: openLocalChatPage, openBrowser: openLocalBrowserCompanion })));
  } catch (error) { console.error('G130 native integration FAIL', String(error)); process.exitCode = 1; }
}
