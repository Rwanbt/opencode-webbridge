import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableOperationFence, type DurableOperationIdentity } from '../src/core/durable-operation-fence.js';

const id: DurableOperationIdentity = { sessionID: 'session1', agentID: 'agent1',
  turnID: 'turn1', workspaceID: 'workspace1', operationID: 'op-1-digest',
  proposalHash: 'a'.repeat(64) };
const key = randomBytes(32).toString('hex');
async function fixture(run: (root: string, dir: string, witness: string) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-operation-'));
  try { await run(root, join(root, 'journal'), join(root, 'independent')); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

test('fsynced consuming state survives restart without re-execution or silent reset', async () =>
  fixture(async (_root, dir, witness) => {
    let fence = DurableOperationFence.initialize(dir, witness, id, key);
    assert.deepEqual(fence.status(), { phase: 'reserved', revision: 0 });
    fence.consent();
    fence.consume(); // persisted before hypothetical side effect
    assert.equal(fence.status().phase, 'consuming');
    assert.doesNotMatch(readFileSync(join(dir, 'operation.json'), 'utf8'),
      /session1|agent1|workspace1|op-1-digest/);
    fence.close();
    fence = DurableOperationFence.open(dir, witness, id, key);
    try {
      assert.deepEqual(fence.status(), { phase: 'consuming', revision: 2 });
      assert.throws(() => fence.consume(), /replay|transition/);
      assert.throws(() => fence.consent(), /replay|transition/);
      assert.throws(() => fence.cancelled(), /replay|transition/);
      fence.uncertain();
      assert.equal(fence.status().phase, 'uncertain');
    } finally { fence.close(); }
    const later = DurableOperationFence.open(dir, witness, id, key);
    try {
      assert.equal(later.status().phase, 'uncertain');
      await assert.rejects(later.confirm(async () => true), /not consuming/);
    } finally { later.close(); }
  }));

test('host callback failing or false is terminal uncertain, never silently confirmed', async () =>
  fixture(async (_root, dir, witness) => {
    const fence = DurableOperationFence.initialize(dir, witness, id, key);
    try {
      fence.consent();
      fence.consume();
      let attempts = 0;
      assert.equal(await fence.confirm(async () => {
        attempts++; throw new Error('host offline');
      }), 'uncertain');
      assert.equal(attempts, 1);
      assert.equal(fence.status().phase, 'uncertain');
      await assert.rejects(fence.confirm(async () => { attempts++; return true; }), /not consuming/);
      assert.equal(attempts, 1);
    } finally { fence.close(); }
  }));

test('verified final ACK survives restart but never allows a second execution', async () =>
  fixture(async (_root, dir, witness) => {
    let fence = DurableOperationFence.initialize(dir, witness, id, key);
    fence.consent(); fence.consume();
    assert.equal(await fence.confirm(async () => true), 'confirmed'); // trusted fixture only
    assert.equal(fence.status().phase, 'confirmed');
    fence.close();
    fence = DurableOperationFence.open(dir, witness, id, key);
    try {
      assert.equal(fence.status().phase, 'confirmed');
      assert.throws(() => fence.consume(), /replay|transition/);
    } finally { fence.close(); }
  }));

test('exclusive lock, divergent witness, rollback, missing history and wrong scope fail closed', async () =>
  fixture(async (_root, dir, witness) => {
    let fence = DurableOperationFence.initialize(dir, witness, id, key);
    assert.throws(() => DurableOperationFence.open(dir, witness, id, key), /locked/);
    const old = readFileSync(join(dir, 'operation.json'), 'utf8');
    fence.consent();
    fence.close();
    assert.throws(() => DurableOperationFence.open(dir, witness,
      { ...id, agentID: 'intruder' }, key), /integrity|scope|rollback/);
    writeFileSync(join(dir, 'operation.json'), old);
    assert.throws(() => DurableOperationFence.open(dir, witness, id, key), /integrity|rollback/);
    rmSync(dir, { recursive: true, force: true });
    rmSync(witness, { recursive: true, force: true });
    assert.throws(() => DurableOperationFence.open(dir, witness, id, key), /missing/);
  }));

test('untrusted descriptor and linked workspace witness cannot create operation', async () =>
  fixture(async (root, dir, witness) => {
    let reads = 0;
    const poisoned = Object.defineProperty({ ...id }, 'operationID', {
      enumerable: true, get() { reads++; return id.operationID; },
    });
    assert.throws(() => DurableOperationFence.initialize(dir, witness,
      poisoned as DurableOperationIdentity, key), /descriptor/);
    assert.equal(reads, 0);
    // Link a directory in the model-owned scope: never follow it.
    const linked = join(root, 'linked');
    let linkedCreated = false;
    try {
      symlinkSync(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
      linkedCreated = true;
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      // Restricted Windows accounts may not permit junction creation at all.
    }
    if (linkedCreated) assert.throws(
      () => DurableOperationFence.initialize(linked, witness, id, key),
      /linked|independent|directory/,
    );
  }));
