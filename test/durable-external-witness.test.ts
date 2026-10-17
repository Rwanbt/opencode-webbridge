import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';

const binding = { sessionID: 'one', providerID: 'qwen' as const, tabID: 't1', accountRef: 'a1' };
const key = randomBytes(32).toString('hex');

test('separate durable witness refuses replacement with an old but validly HMAC-signed journal', () => {
  const base = mkdtempSync(join(tmpdir(), 'webbridge-witness-'));
  const dir = join(base, 'journal');
  const witnessDir = join(base, 'witness');
  try {
    const first = DurableRelayJournal.open(dir, binding, key, { witnessDir });
    first.prepare('first'); first.leased('first'); first.settled('first');
    first.close();
    const old = readFileSync(join(dir, 'journal.json'));
    const second = DurableRelayJournal.open(dir, binding, key, { witnessDir });
    second.prepare('second'); second.close();
    writeFileSync(join(dir, 'journal.json'), old);
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, { witnessDir }), /witness|rollback/i);
  } finally { rmSync(base, { force: true, recursive: true }); }
});

test('witness cannot be silently enrolled after existing journal or by sharing its directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'webbridge-witness-config-'));
  const dir = join(base, 'journal');
  const witnessDir = join(base, 'witness');
  try {
    const old = DurableRelayJournal.open(dir, binding, key);
    old.prepare('first'); old.close();
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, { witnessDir }), /witness|enroll|missing/i);
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, { witnessDir: dir }), /separate|outside|witness/i);
  } finally { rmSync(base, { force: true, recursive: true }); }
});

test('corrupt witness prevents replay and journal mutation', () => {
  const base = mkdtempSync(join(tmpdir(), 'webbridge-witness-integrity-'));
  const dir = join(base, 'journal');
  const witnessDir = join(base, 'witness');
  try {
    const first = DurableRelayJournal.open(dir, binding, key, { witnessDir });
    first.prepare('first'); first.close();
    const paths = readdirSync(witnessDir).filter((item) => item.endsWith('.json'));
    assert.equal(paths.length, 1);
    const file = join(witnessDir, paths[0]);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    record.revision = 0;
    writeFileSync(file, JSON.stringify(record));
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, { witnessDir }), /witness|integrity/i);
  } finally { rmSync(base, { force: true, recursive: true }); }
});

test('witnessed journal cannot be reopened in weaker unwitnessed mode', () => {
  const base = mkdtempSync(join(tmpdir(), 'webbridge-witness-downgrade-'));
  const dir = join(base, 'journal');
  try {
    const first = DurableRelayJournal.open(dir, binding, key, { witnessDir: join(base, 'witness') });
    first.prepare('first'); first.close();
    assert.throws(() => DurableRelayJournal.open(dir, binding, key), /witness|downgrade/i);
    assert.throws(() => DurableRelayJournal.open(dir, binding, key, { witnessDir: '' }), /witness/i);
  } finally { rmSync(base, { force: true, recursive: true }); }
});
