import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import type { TabClaim } from '../src/core/browser-port.js';

const owner: TabClaim = { sessionID: 's1', providerID: 'qwen', tabID: 't1', accountRef: 'a1' };
const key = randomBytes(32).toString('hex');
function isolated(run: (journalDir: string, witnessDir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-witness-'));
  try { run(join(root, 'journal'), join(root, 'independent-witness')); }
  finally { rmSync(root, { force: true, recursive: true }); }
}

test('restored older HMAC-valid journal is rejected against separate signed witness', () => {
  isolated((dir, witnessDir) => {
    const first = (DurableRelayJournal.open as any)(dir, owner, key, witnessDir);
    first.prepare('old-turn');
    const validOlderState = readFileSync(join(dir, 'journal.json'));
    first.leased('old-turn');
    first.close();
    writeFileSync(join(dir, 'journal.json'), validOlderState);
    assert.throws(() => (DurableRelayJournal.open as any)(dir, owner, key, witnessDir), /witness|rollback/i);
  });
});

test('deleting the signed journal or signed witness cannot silently bootstrap a fresh history', () => {
  isolated((dir, witnessDir) => {
    const first = (DurableRelayJournal.open as any)(dir, owner, key, witnessDir);
    first.prepare('spent');
    first.close();
    unlinkSync(join(dir, 'journal.json'));
    assert.throws(() => (DurableRelayJournal.open as any)(dir, owner, key, witnessDir), /witness|missing|rollback/i);
  });
  isolated((dir, witnessDir) => {
    const first = (DurableRelayJournal.open as any)(dir, owner, key, witnessDir);
    first.prepare('spent');
    first.close();
    unlinkSync(join(witnessDir, 'witness.json'));
    assert.throws(() => (DurableRelayJournal.open as any)(dir, owner, key, witnessDir), /witness|missing|rollback/i);
  });
});

test('clean witnessed crash restart continues with leased turn and no replay', () => {
  isolated((dir, witnessDir) => {
    const first = (DurableRelayJournal.open as any)(dir, owner, key, witnessDir);
    first.prepare('leased-turn');
    first.leased('leased-turn');
    first.close();
    const restored = (DurableRelayJournal.open as any)(dir, owner, key, witnessDir);
    try {
      assert.deepEqual(restored.status(), [{ turnID: 'leased-turn', phase: 'leased' }]);
      assert.throws(() => restored.prepare('leased-turn'), /already/);
      assert.throws(() => restored.prepare('new-turn'), /unresolved/);
    } finally { restored.close(); }
  });
});

test('independent witness cannot alias beneath journal through a symlinked parent', () => {
  isolated((dir, unusedWitness) => {
    mkdirSync(dir);
    const alias = join(unusedWitness, '..', 'journal-alias');
    // Windows directory junctions work without enabling developer-mode symlinks.
    symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => {
      const journal = DurableRelayJournal.open(dir, owner, key, join(alias, 'witness'));
      journal.close();
    }, /independent witness|directory tree/i);
  });
});
