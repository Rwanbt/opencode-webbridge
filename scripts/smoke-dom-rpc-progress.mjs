/** Offline DOM → real Chromium → bounded RPC relay; not official Electron Desktop. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { openLocalChatPage } from '../dist/src/testing/local-chat-page.js';
import { openLocalBrowserCompanion, submitLocalPageTurn } from '../dist/src/testing/local-browser-companion.js';
import { RpcRelayPort } from '../dist/src/core/rpc-relay-port.js';
import { exchangeBrowserTurn } from '../dist/src/core/browser-exchange.js';

const binding = { sessionID: 'local-session', providerID: 'qwen',
  tabID: 'local-tab', accountRef: 'test-account' };
const secret = randomBytes(32).toString('hex');
const relay = new RpcRelayPort(secret);
const site = await openLocalChatPage();
let companion;
try {
  companion = await openLocalBrowserCompanion();
  await relay.claim(binding);
  const request = { turnID: 'local-progressive-turn', prompt: 'STREAMING_LOCAL_PAGE_ONLY' };
  const finished = exchangeBrowserTurn(relay, binding, request, 16);
  await Promise.resolve();
  assert.deepEqual(relay.take(secret, binding), request);
  let lastSeq = 0;
  const output = await submitLocalPageTurn(companion.page, site.url, request.prompt, async (chunk, seq) => {
    assert.equal(seq, ++lastSeq);
    relay.progress(secret, binding, request.turnID, seq, chunk);
    const frames = await relay.events(binding, request.turnID, seq - 1);
    assert.deepEqual(frames, [{ seq, turnID: request.turnID, kind: 'text', value: chunk }]);
  });
  assert.equal(lastSeq, 3);
  assert.equal(output, `WEBBRIDGE_LOCAL_PAGE_OK:${request.prompt}`);
  relay.complete(secret, binding, request.turnID, output);
  assert.equal(await finished, output);
  assert.deepEqual((await relay.events(binding, request.turnID, 3)).map((e) => e.kind), ['finished']);

  // A stopped page has no confirmed terminal result and must not be resent.
  const interrupted = { turnID: 'local-stopped-turn', prompt: 'STOP_AFTER_FIRST_CHUNK' };
  await relay.submit(binding, interrupted);
  assert.deepEqual(relay.take(secret, binding), interrupted);
  await assert.rejects(submitLocalPageTurn(companion.page, site.url, interrupted.prompt, async (chunk, seq) => {
    relay.progress(secret, binding, interrupted.turnID, seq, chunk);
    if (seq === 1) await companion.page.getByRole('button', { name: 'Stop' }).click();
  }), /uncertain: stopped after submit/);
  assert.equal((await relay.events(binding, interrupted.turnID, 0))[0]?.kind, 'text');
  assert.equal(await relay.cancel(binding, interrupted.turnID), false);
  await assert.rejects(relay.submit(binding, { turnID: 'blind-retry', prompt: 'bad' }), /already busy/);
  console.log('G65 local Chromium DOM-to-RPC progress PASS: 3 observed frames; stop remains uncertain');
} finally {
  await relay.release(binding).catch(() => {});
  await companion?.close();
  await site.close();
}
