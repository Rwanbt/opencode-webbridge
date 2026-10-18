import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createG130ReceiptHost } from './g130-receipt-host.mjs';

test('G130 real encrypted sink: lost ACK survives sink reopen and native-host boundary', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'g130-read-ack-test-'));
  const id = { sessionID: 'ses_fixture', providerID: 'qwen', accountRef: 'fixtureAccount',
    tabID: 'chromiumPage', tabGeneration: 'tabGeneration', connectionID: 'loopbackConnection',
    connectionGeneration: 'connectionGeneration' };
  const secret = randomBytes(32).toString('hex');
  let host;
  try {
    host = await createG130ReceiptHost({ temp, identity: id, turnID: 'readTurn1', secret });
    const first = { kind: 'text', seq: 1, turnID: 'readTurn1', value: 'G130_PRIVATE_DOM_FRAGMENT' };
    await host.acknowledge(first);
    const afterLostACK = readFileSync(host.encryptedPath, 'utf8');
    assert.ok(!afterLostACK.includes(first.value), 'text must not occur in plaintext on disk');
    await host.acknowledge(first);
    assert.equal(readFileSync(host.encryptedPath, 'utf8'), afterLostACK, 'duplicate must never rewrite');
    await assert.rejects(host.acknowledge({ ...first, value: 'forged' }), /conflict/);
    await host.acknowledge({ kind: 'cancelled', seq: 2, turnID: 'readTurn1' });
    await assert.rejects(host.acknowledge({ kind: 'finished', seq: 3, turnID: 'readTurn1' }), /terminal/);
    host.close();
    assert.deepEqual(await host.verifyRestored(['text', 'cancelled']),
      { acknowledged: 2, terminal: 'cancelled', scopedToNativeSession: true,
        lostAckReconciled: true, wrongScopeDenied: true, encrypted: true });
  } finally { host?.close(); rmSync(temp, { recursive: true, force: true }); }
});
