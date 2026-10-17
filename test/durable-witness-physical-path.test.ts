import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';

const owner = { sessionID: 'one', providerID: 'qwen' as const, tabID: 't1', accountRef: 'a1' };
const key = randomBytes(32).toString('hex');

test('external witness cannot be placed physically inside journal through a parent junction', () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-e2-physical-'));
  const journalDir = join(root, 'journal');
  const alias = join(root, 'alias');
  try {
    mkdirSync(journalDir);
    symlinkSync(journalDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasInside = join(alias, 'witness');
    assert.throws(() => DurableRelayJournal.open(journalDir, owner, key,
      { witnessDir: aliasInside }), /witness.*(separate|nested|physical|outside)/i);
    assert.equal(existsSync(join(journalDir, 'journal.json')), false);
    // A normal sibling witness remains usable after refusing a deceptive alias.
    const safe = DurableRelayJournal.open(journalDir, owner, key,
      { witnessDir: join(root, 'witness-outside') });
    safe.prepare('safe');
    safe.close();
    const reopen = DurableRelayJournal.open(journalDir, owner, key,
      { witnessDir: join(root, 'witness-outside') });
    assert.deepEqual(reopen.status(), [{ turnID: 'safe', phase: 'prepared' }]);
    reopen.close();
  } finally { rmSync(root, { force: true, recursive: true }); }
});

test('external witness record must not share an inode with a hardlink inside the journal', () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-e2-hardlink-'));
  const journalDir = join(root, 'journal');
  const witnessDir = join(root, 'witness');
  try {
    const first = DurableRelayJournal.open(journalDir, owner, key, { witnessDir });
    first.prepare('turn1'); first.close();
    const witness = join(witnessDir, readdirSync(witnessDir).find((f) => f.endsWith('.json'))!);
    linkSync(witness, join(journalDir, 'internal-hardlink.json'));
    assert.throws(() => DurableRelayJournal.open(journalDir, owner, key, { witnessDir }),
      /witness.*(hardlink|links|outside|physical)/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('in-process witness rejects a newly added hardlink before next journal transition', () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-e2-hardlink-live-'));
  const journalDir = join(root, 'journal');
  const witnessDir = join(root, 'witness');
  try {
    const live = DurableRelayJournal.open(journalDir, owner, key, { witnessDir });
    live.prepare('turn1');
    const witness = join(witnessDir, readdirSync(witnessDir).find((f) => f.endsWith('.json'))!);
    linkSync(witness, join(journalDir, 'internal-hardlink.json'));
    assert.throws(() => live.cancelled('turn1'), /witness.*(hardlink|outside|boundary)/i);
    assert.deepEqual(live.status(), [{ turnID: 'turn1', phase: 'prepared' }]);
    live.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('both cross-file crash orderings refuse replay without operator recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-e2-crash-'));
  const journalDir = join(root, 'journal');
  const witnessDir = join(root, 'witness');
  try {
    const j = DurableRelayJournal.open(journalDir, owner, key, { witnessDir });
    const oldJournal = readFileSync(join(journalDir, 'journal.json'));
    const witnessName = readdirSync(witnessDir).find((p) => p.endsWith('.json'))!;
    const witnessPath = join(witnessDir, witnessName);
    const oldWitness = readFileSync(witnessPath);
    j.prepare('turn1'); j.close();
    const newJournal = readFileSync(join(journalDir, 'journal.json'));
    const newWitness = readFileSync(witnessPath);

    // Crash between witness rename and journal rename: newer witness, older journal.
    writeFileSync(join(journalDir, 'journal.json'), oldJournal);
    assert.throws(() => DurableRelayJournal.open(journalDir, owner, key, { witnessDir }), /witness.*(mismatch|rollback)/i);

    // Independent rollback of witness: newer journal, older witness.
    writeFileSync(join(journalDir, 'journal.json'), newJournal);
    writeFileSync(witnessPath, oldWitness);
    assert.throws(() => DurableRelayJournal.open(journalDir, owner, key, { witnessDir }), /witness.*(mismatch|rollback)/i);
    // Verify the current valid pair is still recognized after restoring both.
    writeFileSync(witnessPath, newWitness);
    const restored = DurableRelayJournal.open(journalDir, owner, key, { witnessDir });
    assert.deepEqual(restored.status(), [{ turnID: 'turn1', phase: 'prepared' }]);
    restored.close();
  } finally { rmSync(root, { force: true, recursive: true }); }
});
