/** G130: HOST-SIDE fixture sink. Native CLI RPC supplies frames, not Core authority. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function createG130ReceiptHost({ temp, identity, turnID,
  secret = randomBytes(32).toString('hex') }) {
  const { DurableReadAckSink } = await import(pathToFileURL(
    join(root, 'dist/src/core/durable-read-ack-sink.js')).href);
  const dir = join(temp, 'g130-read-ack-' + turnID);
  const witness = join(temp, 'g130-read-witness-' + turnID);
  const encryptedPath = join(dir, 'read-ack.enc.json');
  let sink = DurableReadAckSink.initialize(dir, witness, identity, turnID, secret);
  let lostAckReconciled = false;
  let closed = false;
  const close = () => { if (!closed) { sink.close(); closed = true; } };
  return {
    encryptedPath,
    async acknowledge(event) {
      if (closed) throw new Error('G130 sink already closed');
      await sink.acknowledge(event); // Synchronously fsync'd durable receipt BEFORE local SSE.
      if (event.seq === 1 && !lostAckReconciled) {
        // Adversary drops the first host ACK AFTER commit, before model advances.
        const original = readFileSync(encryptedPath, 'utf8');
        sink.close();
        sink = DurableReadAckSink.open(dir, witness, identity, turnID, secret);
        await sink.acknowledge(event); // Replay only to sink, NEVER to browser/CLI.
        assert.equal(readFileSync(encryptedPath, 'utf8'), original, 'lost ACK triggered duplicate effect');
        lostAckReconciled = true;
      }
    },
    close,
    async verifyRestored(expectedKinds) {
      close(); // Called after actual native OpenCode host has stopped and restarted.
      assert.throws(() => DurableReadAckSink.open(dir, witness,
        { ...identity, sessionID: 'ses_wrong_native_session' }, turnID, secret),
      /integrity|rollback|mismatch/);
      assert.throws(() => DurableReadAckSink.open(dir, witness,
        { ...identity, tabGeneration: 'wrongGeneration' }, turnID, secret),
      /integrity|rollback|mismatch/);
      const recovered = DurableReadAckSink.open(dir, witness, identity, turnID, secret);
      try {
        const frames = recovered.readAll();
        assert.deepEqual(frames.map((item) => item.kind), expectedKinds);
        assert.ok(frames.every((item, idx) => item.seq === idx + 1 && item.turnID === turnID));
        assert.ok(lostAckReconciled, 'simulated post-fsync lost ACK not recovered');
        const encrypted = readFileSync(encryptedPath, 'utf8');
        assert.ok(frames.every((item) => item.kind !== 'text' || !encrypted.includes(item.value)),
          'plaintext DOM frames leaked into encrypted receipt');
        const terminal = frames.at(-1)?.kind;
        assert.ok(terminal === 'finished' || terminal === 'cancelled');
        return { acknowledged: frames.length, terminal, scopedToNativeSession: true,
          lostAckReconciled, wrongScopeDenied: true, encrypted: true };
      } finally { recovered.close(); }
    },
  };
}
