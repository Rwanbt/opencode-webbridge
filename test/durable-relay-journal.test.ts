import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DurableRelayJournal } from '../src/core/durable-relay-journal.js';
import { RpcRelayPort } from '../src/core/rpc-relay-port.js';
import type { TabClaim } from '../src/core/browser-port.js';

const claim: TabClaim = { sessionID: 'session-1', providerID: 'qwen', tabID: 'tab-1', accountRef: 'account-1' };
const secret = randomBytes(32).toString('hex');

async function isolated(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-durable-journal-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('in-flight browser turn survives restart as uncertain and cannot replay', async () => {
  await isolated(async (dir) => {
      const first = DurableRelayJournal.open(dir, claim, secret);
      const relay1 = new RpcRelayPort(secret, first);
      await relay1.claim(claim);
      await relay1.submit(claim, { turnID: 'turn-1', prompt: 'private prompt' });
      assert.deepEqual(relay1.take(secret, claim), { turnID: 'turn-1', prompt: 'private prompt' });
      first.close();
      const second = DurableRelayJournal.open(dir, claim, secret);
      try {
        const relay2 = new RpcRelayPort(secret, second);
        await relay2.claim(claim);
        assert.equal(relay2.take(secret, claim), null);
        await assert.rejects(relay2.submit(claim, { turnID: 'turn-1', prompt: 'private prompt' }), /already recorded/);
        await assert.rejects(relay2.submit(claim, { turnID: 'turn-2', prompt: 'different' }), /unresolved/);
        assert.deepEqual(second.status(), [{ turnID: 'turn-1', phase: 'leased' }]);
        const data = readFileSync(join(dir, 'journal.json'), 'utf8');
        assert.doesNotMatch(data, /private prompt|account-1|tab-1|session-1/);
      } finally { second.close(); }
  });
});

test('settled turns remain permanently deduplicated after clean restart', async () => {
  await isolated(async (dir) => {
      const first = DurableRelayJournal.open(dir, claim, secret);
      const relay = new RpcRelayPort(secret, first);
      await relay.claim(claim);
      await relay.submit(claim, { turnID: 'done-1', prompt: 'hidden' });
      relay.take(secret, claim);
      relay.complete(secret, claim, 'done-1', 'secret response');
      first.close();
      const second = DurableRelayJournal.open(dir, claim, secret);
      try {
        assert.deepEqual(second.status(), [{ turnID: 'done-1', phase: 'settled' }]);
        assert.doesNotMatch(readFileSync(join(dir, 'journal.json'), 'utf8'), /hidden|secret response/);
        const reopened = new RpcRelayPort(secret, second);
        await reopened.claim(claim);
        await assert.rejects(reopened.submit(claim, { turnID: 'done-1', prompt: 'hidden' }), /already recorded/);
        await reopened.submit(claim, { turnID: 'fresh-2', prompt: 'new' });
        assert.equal(reopened.take(secret, claim)?.turnID, 'fresh-2');
      } finally { second.close(); }
  });
});

test('wrong binding, corrupt data and concurrent owners are refused', async () => {
  await isolated((dir) => {
    const first = DurableRelayJournal.open(dir, claim, secret);
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /locked/);
    first.close();
    assert.throws(() => DurableRelayJournal.open(dir, { ...claim, accountRef: 'other' }, secret), /binding/);
    writeFileSync(join(dir, 'journal.json'), '{"broken":true}', 'utf8');
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /invalid journal/);
  });
});

test('tampered journal is rejected even when its JSON structure is plausible', async () => {
  await isolated((dir) => {
    const journal = DurableRelayJournal.open(dir, claim, secret);
    journal.prepare('turn-1');
    journal.close();
    const path = join(dir, 'journal.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.entries[0].phase = 'settled';
    writeFileSync(path, JSON.stringify(data));
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /integrity mismatch/);
  });
});

test('wrong signing key and leftover crash lock never trigger automatic recovery', async () => {
  await isolated((dir) => {
    const first = DurableRelayJournal.open(dir, claim, secret);
    first.prepare('uncertain-1');
    first.close();
    assert.throws(() => DurableRelayJournal.open(dir, claim, randomBytes(32).toString('hex')), /integrity/);
    const lock = join(dir, '.lock');
    writeFileSync(lock, 'stale-after-crash');
    assert.throws(() => DurableRelayJournal.open(dir, claim, secret), /locked/);
    // An operator must verify that no live owner exists before clearing this lock.
    rmSync(lock);
    const reopened = DurableRelayJournal.open(dir, claim, secret);
    try {
      assert.deepEqual(reopened.status(), [{ turnID: 'uncertain-1', phase: 'prepared' }]);
      assert.throws(() => reopened.prepare('fresh-2'), /unresolved/);
    } finally { reopened.close(); }
  });
});

test('modified ownership lock fails closed and cannot be deleted by former owner', async () => {
  await isolated((dir) => {
    const journal = DurableRelayJournal.open(dir, claim, secret);
    const lock = join(dir, '.lock');
    const original = readFileSync(join(dir, 'journal.json'), 'utf8');
    // Simulate a different local process clobbering the active ownership marker.
    writeFileSync(lock, 'replaced-by-second-owner', 'utf8');
    assert.throws(() => journal.prepare('must-not-run'), /lock ownership lost/);
    assert.equal(readFileSync(join(dir, 'journal.json'), 'utf8'), original);
    journal.close();
    assert.equal(existsSync(lock), true, 'former owner must not delete an alien lock');
  });
});
