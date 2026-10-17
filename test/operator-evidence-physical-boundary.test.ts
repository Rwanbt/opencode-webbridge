import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';

const owner = { sessionID: 's1', providerID: 'qwen' as const, tabID: 't1', accountRef: 'a1' };
const key = randomBytes(32).toString('hex');
const script = resolve('scripts/reconcile-relay.mjs');

function fixture(testCase: (root: string, dir: string, evidence: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'webbridge-e2-operator-'));
  const dir = join(root, 'journal');
  mkdirSync(dir);
  const inside = join(dir, 'internal-evidence.txt');
  writeFileSync(inside, 'fake evidence inside journal - not independent');
  try { testCase(root, dir, inside); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function resolveEvidence(dir: string, evidenceFile: string): number | null {
  const journal = DurableRelayJournal.open(dir, owner, key);
  journal.prepare('turn1'); journal.close();
  const expected = createHash('sha256').update('fake evidence inside journal - not independent').digest('hex');
  const result = spawnSync(process.execPath, [script, 'resolve', '--dir', dir,
    '--session', 's1', '--provider', 'qwen', '--tab', 't1', '--account', 'a1',
    '--turn', 'turn1', '--outcome', 'observed-not-applied',
    '--evidence-sha256', expected, '--evidence-file', evidenceFile,
    '--operator', 'reviewer', '--ack', 'I-VERIFIED-REMOTE-OUTCOME'], {
      encoding: 'utf8', env: { ...process.env, WEBBRIDGE_RELAY_TOKEN: key },
    });
  const reopened = DurableRelayJournal.open(dir, owner, key);
  try { assert.deepEqual(reopened.status(), [{ turnID: 'turn1', phase: 'prepared' }]); }
  finally { reopened.close(); }
  return result.status;
}

test('operator cannot accept a physical inside-journal evidence through an ancestor junction', () => {
  fixture((root, dir, inside) => {
    const alias = join(root, 'apparently-external');
    symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir');
    assert.notEqual(resolveEvidence(dir, join(alias, 'internal-evidence.txt')), 0);
  });
});

test('operator cannot accept an external hardlink to an internal journal evidence inode', () => {
  fixture((root, dir, inside) => {
    const outside = join(root, 'apparently-external.txt');
    linkSync(inside, outside);
    assert.notEqual(resolveEvidence(dir, outside), 0);
  });
});
