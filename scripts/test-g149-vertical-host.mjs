import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createG149VerticalHost } from './g149-vertical-host.mjs';

const scenario = async (controls, verify) => {
  const temp = await mkdtemp(join(tmpdir(), 'g149-boundary-'));
  try {
    const identity = { temp, sessionID: 'ses_g149_test',
      turnID: randomBytes(16).toString('hex'), ...controls };
    const host = await createG149VerticalHost(identity);
    try { await verify(host); } finally { host.close(); }
  } finally { await rm(temp, { recursive: true, force: true }); }
};

test('G149 refuses to create a Linux fixture host on unsupported OS', {
  skip: process.platform === 'linux',
}, async () => {
  await assert.rejects(scenario({}, () => {}),
    /Linux CI/);
});

test('G149 host permission denies filesystem reads before native SSE forwarding', {
  skip: process.platform !== 'linux',
}, async () => {
  let verified = false;
  await scenario({ authorize: async () => false,
    verifyReceipt: async () => { verified = true; return true; } },
  async (host) => {
    await assert.rejects(host.runReadonlyTool(), /permission revoked/);
    await assert.rejects(host.runReadonlyTool(), /second tool invocation/);
    assert.equal(verified, false);
  });
});

test('G149 rejects forged session identity before creating trusted callback', {
  skip: process.platform !== 'linux',
}, async () => {
  let callback = 0;
  await assert.rejects(scenario({ sessionID: 'ses\nmalicious',
    authorize: async () => { callback++; return true; } }, () => {}),
  /session identity invalid/);
  assert.equal(callback, 0);
});

test('G149 true Linux temporary file read precedes encrypted RPC ACK and refuses second run', {
  skip: process.platform !== 'linux',
}, async () => {
  await scenario({}, async (host) => {
    await host.runReadonlyTool();
    await assert.rejects(host.runReadonlyTool(), /second tool invocation/);
    // Event receipts are host committed in the same order later emitted as SSE.
    const turnID = host.testTurnID;
    assert.match(turnID, /^[a-f0-9]{32}$/);
    await host.acknowledge({ turnID, seq: 1, kind: 'text', value: 'local reply' });
    await host.acknowledge({ turnID, seq: 2, kind: 'finished' });
    const restored = await host.verifyRestored(['text', 'finished']);
    assert.equal(restored.readonlyToolConfirmed, true);
    assert.equal(restored.nativeSessionBound, true);
    assert.equal(restored.acknowledged, 2);
  });
});
