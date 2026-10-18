/** Operator reconciliation of the durable native attempt journal: strict
 *  invocation, exact target resolution, evidence-preserving abandonment, and the
 *  transport rule that an abandoned attempt is never reconciled again. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  abandonJournalEntry, describeJournalEntry, parseJournalInvocation, resolveJournalTarget,
} from "../src/native/journal-operator.js";
import {
  ATTEMPT_FILE_PREFIX, createFileAttemptStore, type JournalEntry,
} from "../src/native/attempt-store.js";
import {
  createBrowserTurnTransport, type AttemptRecord, type BrowserTurnAttachment,
} from "../src/native/browser-turn-transport.js";
import type { NativeTurnEvent, NativeTurnRequest } from "../src/native/turn-transport.js";

const TURN = "a".repeat(32);
const OTHER_TURN = "b".repeat(32);
const KEY_A = "1".repeat(64);
const KEY_B = "1".repeat(60) + "abcd";
const KEY_C = "2".repeat(64);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const entry = (key: string, record: AttemptRecord): JournalEntry => Object.freeze({ key, record });
const inflight = (turnID: string, at = 1): AttemptRecord => ({ turnID, state: "inflight", at });

test("the operator invocation is strict: list by default, explicit target only", () => {
  assert.deepEqual(parseJournalInvocation([]), { action: "list" });
  assert.deepEqual(parseJournalInvocation(["--journal", "D:/journal"]),
    { action: "list", journalDir: "D:/journal" });
  assert.deepEqual(parseJournalInvocation(["--abandon", TURN]), { action: "abandon", target: TURN });
  assert.deepEqual(parseJournalInvocation(["--journal", "D:/j", "--abandon", "abcdef12"]),
    { action: "abandon", target: "abcdef12", journalDir: "D:/j" });
  for (const bad of [
    ["--abandon"], ["--journal"], ["--journal", "  "], ["--abandon", "short"],
    ["--abandon", "*"], ["--abandon", "a".repeat(65)], ["--abandon", "a b c d e f"],
    ["--unknown", "x"], ["--abandon", TURN, "--abandon", TURN],
  ]) {
    assert.throws(() => parseJournalInvocation(bad), /WebBridge journal refusal/, JSON.stringify(bad));
  }
});

test("target resolution accepts one exact match only and refuses ambiguity", () => {
  const single = [entry(KEY_A, inflight(TURN))];
  assert.equal(resolveJournalTarget(single, TURN).key, KEY_A, "a full turn id resolves");
  assert.equal(resolveJournalTarget(single, KEY_A.slice(0, 8)).key, KEY_A, "one prefix resolves");
  assert.throws(() => resolveJournalTarget(single, "3".repeat(8)), /unknown target/);
  const sharedPrefix = [entry(KEY_A, inflight(TURN)), entry(KEY_B, inflight(OTHER_TURN))];
  assert.throws(() => resolveJournalTarget(sharedPrefix, "1".repeat(8)), /ambiguous target/);
  const duplicatedTurn = [entry(KEY_A, inflight(TURN)), entry(KEY_C, inflight(TURN))];
  assert.throws(() => resolveJournalTarget(duplicatedTurn, TURN), /several records/);
});

test("abandoning a provisional attempt preserves its evidence and is idempotent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-journal-"));
  try {
    const store = createFileAttemptStore(dir);
    const record: AttemptRecord = {
      turnID: TURN, state: "inflight", at: 10, messageKey: "m1",
      progress: { seq: 1, length: 5, hash: digest("Hello") },
      scope: { tabID: "tab12345", generation: 3 },
    };
    await store.write(KEY_A, record);
    const listed = await store.list();
    assert.deepEqual(listed, [{ key: KEY_A, record }]);
    assert.deepEqual(await abandonJournalEntry(store, listed[0]!, 20), { changed: true, turnID: TURN });
    const abandoned = (await store.list())[0]!.record;
    assert.equal(abandoned.state, "abandoned");
    assert.equal(abandoned.at, 20);
    assert.equal(abandoned.messageKey, "m1");
    assert.deepEqual(abandoned.progress, record.progress, "the delivery cursor is preserved");
    assert.deepEqual(abandoned.scope, record.scope, "the recorded browser scope is preserved");
    assert.deepEqual(await abandonJournalEntry(store, (await store.list())[0]!, 30),
      { changed: false, turnID: TURN });
    assert.equal((await store.list())[0]!.record.at, 20, "an abandoned record is never rewritten");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a corrupt or misnamed journal entry refuses the whole listing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-journal-corrupt-"));
  try {
    const store = createFileAttemptStore(dir);
    await store.write(KEY_A, inflight(TURN));
    assert.equal((await store.list()).length, 1);
    await writeFile(join(dir, ATTEMPT_FILE_PREFIX + KEY_B + ".json"), "{ not json\n");
    await assert.rejects(store.list(), /corrupt attempt record/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
  const other = await mkdtemp(join(tmpdir(), "wb-journal-name-"));
  try {
    await writeFile(join(other, ATTEMPT_FILE_PREFIX + "not-a-key.json"), "{}\n");
    await assert.rejects(createFileAttemptStore(other).list(), /corrupt attempt record/);
  } finally {
    await rm(other, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("the operator line never prints the prefix digest or any assistant text", () => {
  const line = describeJournalEntry(entry(KEY_A, {
    turnID: TURN, state: "inflight", at: 1_000, messageKey: "m1",
    progress: { seq: 2, length: 7, hash: digest("Hello w") },
    scope: { tabID: "tab12345", generation: 3 },
  }), 5_000);
  assert.match(line, /state=inflight/);
  assert.match(line, /message=m1/);
  assert.match(line, /acked=2\/7/);
  assert.match(line, /tab=tab12345#3/);
  assert.match(line, /age=4s/);
  assert.doesNotMatch(line, new RegExp(digest("Hello w")));
});

test("an operator-abandoned attempt is never reconciled: a later identical prompt is a new turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-journal-turn-"));
  try {
    const store = createFileAttemptStore(dir);
    const turnIDs: string[] = [];
    const attachment = (text: string): BrowserTurnAttachment => ({
      identity: { tabID: "tab12345", generation: 1 },
      baseline: null,
      async send(_prompt: string, turnID: string) { turnIDs.push(turnID); },
      async sample() { return { messageKey: "m2", text }; },
      async close() {},
    });
    const request: NativeTurnRequest = {
      providerID: "p", modelID: "m", prompt: "same prompt", signal: new AbortController().signal,
    };
    const collect = async (text: string) => {
      const events: NativeTurnEvent[] = [];
      const transport = createBrowserTurnTransport({
        providerID: "p", modelID: "m", store, intervalMs: 20, polls: 2,
        attach: async () => attachment(text),
      });
      for await (const event of transport.stream(request)) events.push(event);
      return events;
    };

    const first = await collect("Hello");
    assert.deepEqual(first.at(-1), {
      kind: "terminal", state: "uncertain", reason: "provider-finality-unverified",
    });
    assert.equal(turnIDs.length, 1);

    const listed = await store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.record.state, "uncertain");
    await abandonJournalEntry(store, listed[0]!, Date.now());

    await collect("Hello again");
    assert.equal(turnIDs.length, 2, "an abandoned attempt must not block a new deliberate turn");
    assert.notEqual(turnIDs[0], turnIDs[1], "the new deliberate turn gets a new identity");
    assert.equal((await store.list())[0]!.record.state, "uncertain",
      "the new turn's own outcome is what the journal records");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
