/** G151: native CLI fixture turn -> G145 host read -> G148 fsynced SSE reconnect.
 * No OS trusted Desktop/BrowserLease attestation. No commercial adapters. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { proveG149 } from './smoke-g149-vertical.mjs';
import { createG149VerticalHost } from './g149-vertical-host.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function createG151Host({ onRestored, ...meta }) {
  const [{ OfflineSseResumeHost }, g149] = await Promise.all([
    import(pathToFileURL(join(root, 'dist/src/testing/offline-sse-resume-host.js')).href),
    createG149VerticalHost(meta),
  ]);
  const identity = Object.freeze({
    sessionID: meta.sessionID, providerID: 'qwen', accountRef: 'g151LocalFixture',
    tabID: 'g151Chromium', tabGeneration: 'g151Tab',
    connectionID: 'g151LocalHost', connectionGeneration: 'g151Conn',
  });
  const secret = randomBytes(32).toString('hex');
  const dir = join(meta.temp, 'g151-sse-' + meta.turnID);
  let host = OfflineSseResumeHost.initialize(dir, identity, meta.turnID, secret, 1000);
  const from = host.startCursor();
  let lastSeq = 0;
  return {
    ...g149,
    async acknowledge(event) {
      assert.ok(event.seq === lastSeq + 1 || event.seq <= lastSeq,
        'native RPC sequence cannot skip host committed receipt');
      // Persist encrypted event and signed cursor first. Then the unchanged
      // G130 encrypted ACK must complete before upstream SSE forwarding.
      const ack = await host.acknowledgeRead(event, identity, 1000 + event.seq * 100);
      assert.equal(ack.status, event.seq <= lastSeq ? 'duplicate' : 'committed');
      lastSeq = Math.max(lastSeq, event.seq);
      await g149.acknowledge(event);
    },
    close() { g149.close(); host.close(); },
    async verifyRestored(kinds) {
      const previous = await g149.verifyRestored(kinds);
      host.close();
      host = OfflineSseResumeHost.open(dir, identity, meta.turnID, secret, 2000);
      try {
        const recovered = host.replay(from, identity, 2200);
        assert.deepEqual(recovered.map((e) => e.event.kind), kinds);
        assert.ok(recovered.every((e, i) => e.event.seq === i + 1));
        const last = recovered.at(-1)?.cursor;
        assert.ok(last);
        assert.deepEqual(host.replay(last, identity, 2201), []);
        assert.throws(() => host.replay(from,
          { ...identity, accountRef: 'otherAccount' }, 2202), /denied|scope/);
        // No second model/DOM/native RPC invoke on reconnect: data-only host replay.
        onRestored(Object.freeze({ nativeSessionBound: true,
          durablyResumableSSE: true, events: recovered.length,
          terminal: recovered.at(-1)?.event.kind }));
      } finally { host.close(); }
      return { ...previous, durablyResumableSSE: true };
    },
  };
}

export async function proveG151({ openPage, openBrowser }) {
  const restored = [];
  const native = await proveG149({
    openPage, openBrowser,
    receiptFactory: (meta) =>
      createG151Host({ ...meta, onRestored: (event) => restored.push(event) }),
  });
  assert.equal(restored.length, 6);
  assert.deepEqual(restored.map((x) => x.terminal),
    ['finished','finished','cancelled','finished','finished','cancelled']);
  assert.ok(restored.every((x) => x.nativeSessionBound && x.durablyResumableSSE &&
    (x.events === 2 || x.events === 4)));
  return { ...native, nativeRpcSseSameTurn: true, reconnectDataOnly: true,
    verifiedSseReceipts: restored.length, osPrincipalAttested: false,
    patchedCoreSameProcess: false, commercialProvidersOperational: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'linux') throw new Error('G151 Chromium Linux CI only');
    const { openLocalChatPage } = await import(pathToFileURL(
      join(root, 'dist/src/testing/local-chat-page.js')).href);
    const { openLocalBrowserCompanion } = await import(pathToFileURL(
      join(root, 'dist/src/testing/local-browser-companion.js')).href);
    console.log('G151 official CLI+host durable resumed SSE PASS',
      JSON.stringify(await proveG151({
        openPage: openLocalChatPage, openBrowser: openLocalBrowserCompanion,
      })));
  } catch (error) {
    console.error('G151 native model SSE integration NO-GO:', String(error));
    process.exitCode = 1;
  }
}
