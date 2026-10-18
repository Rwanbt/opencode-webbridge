/** Durable progressive delivery of the native browser turn transport.
 *
 * Storage-first ACK: a fragment is delivered only after its exact prefix is
 * durably recorded. A reconciled attempt (model retry, crash, restart) resumes
 * after the acknowledged prefix instead of replaying it, refuses a changed or
 * shortened answer, never re-sends the prompt, and never fabricates text. The
 * journal stores only the delivered length and a digest of that prefix: the
 * assistant text itself is never persisted. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBrowserTurnTransport, type AttemptRecord, type AttemptStore,
  type BrowserTurnAttachment, type BrowserTurnObservation,
} from "../src/native/browser-turn-transport.js";
import { ATTEMPT_FILE_PREFIX, createFileAttemptStore } from "../src/native/attempt-store.js";
import type { NativeTurnEvent, NativeTurnTransport } from "../src/native/turn-transport.js";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const promptPath = (prompt: string) => createHash("sha256")
  .update("p\0m\0" + prompt).digest("hex");

class MemoryStore implements AttemptStore {
  readonly records = new Map<string, AttemptRecord>();
  readonly writes: AttemptRecord[] = [];
  /** 1-based write index that must fail (0 = never). */
  failAt = 0;
  private count = 0;
  async read(key: string): Promise<AttemptRecord | undefined> { return this.records.get(key); }
  async write(key: string, record: AttemptRecord): Promise<void> {
    this.count += 1;
    if (this.failAt === this.count) throw new Error("journal write failed");
    this.records.set(key, record);
    this.writes.push(record);
  }
  async discard(key: string): Promise<void> { this.records.delete(key); }
}

interface FakeBrowser {
  baseline: BrowserTurnObservation | null;
  answer: BrowserTurnObservation | null;
  sends: number;
  completion?: (observation: BrowserTurnObservation) => boolean;
}

const attachmentOf = (state: FakeBrowser): BrowserTurnAttachment => ({
  get baseline() { return state.baseline; },
  async send() { state.sends += 1; },
  async sample() { return state.answer; },
  ...(state.completion === undefined ? {} : { completion: state.completion }),
  async close() {},
});

const transportFor = (store: AttemptStore, state: FakeBrowser, polls = 3) =>
  createBrowserTurnTransport({
    providerID: "p", modelID: "m", polls, intervalMs: 20,
    store, attach: async () => attachmentOf(state),
  });

const request = (prompt: string) => ({
  providerID: "p", modelID: "m", prompt, signal: new AbortController().signal,
});
const iteratorOf = (transport: NativeTurnTransport, prompt: string) =>
  transport.stream(request(prompt))[Symbol.asyncIterator]();
const drain = async (transport: NativeTurnTransport, prompt: string) => {
  const events: NativeTurnEvent[] = [];
  for await (const event of transport.stream(request(prompt))) events.push(event);
  return events;
};
const fragments = (events: readonly NativeTurnEvent[]) =>
  events.filter((event) => event.kind === "fragment").map((event) => (event as { text: string }).text);

test("a fragment is durable before it is delivered, and the terminal persists the final cursor", async () => {
  const store = new MemoryStore();
  const state: FakeBrowser = { baseline: null, answer: { messageKey: "k1", text: "Hello" }, sends: 0 };
  const transport = transportFor(store, state);
  const iterator = iteratorOf(transport, "hi");
  const first = await iterator.next();
  assert.deepEqual(first.value, { kind: "fragment", text: "Hello" });
  const inflight = await store.read(promptPath("hi"));
  assert.equal(inflight?.state, "inflight");
  assert.equal(inflight?.messageKey, "k1");
  assert.deepEqual(inflight?.progress, { seq: 1, length: 5, hash: digest("Hello") });
  const rest: NativeTurnEvent[] = [];
  for (let next = await iterator.next(); !next.done; next = await iterator.next()) rest.push(next.value);
  assert.deepEqual(rest, [{ kind: "terminal", state: "uncertain", reason: "provider-finality-unverified" }]);
  const settled = await store.read(promptPath("hi"));
  assert.equal(settled?.state, "uncertain");
  assert.deepEqual(settled?.progress, { seq: 1, length: 5, hash: digest("Hello") });
  assert.equal(state.sends, 1);
});

test("a reconciled attempt resumes after the acknowledged prefix and never re-sends", async () => {
  const store = new MemoryStore();
  const state: FakeBrowser = { baseline: null, answer: { messageKey: "k1", text: "Hello" }, sends: 0 };
  const transport = transportFor(store, state);
  const first = iteratorOf(transport, "hi");
  assert.equal((await first.next()).value?.kind, "fragment");
  await first.return?.(undefined); // crash/restart right after the first acknowledged fragment
  assert.equal(state.sends, 1);

  state.answer = { messageKey: "k1", text: "Hello world" };
  const resumed = await drain(transport, "hi");
  assert.deepEqual(fragments(resumed), [" world"]);
  assert.deepEqual(resumed.at(-1), { kind: "terminal", state: "uncertain", reason: "provider-finality-unverified" });
  assert.equal(state.sends, 1, "a reconciled attempt must never issue a second browser send");
  assert.deepEqual((await store.read(promptPath("hi")))?.progress,
    { seq: 2, length: 11, hash: digest("Hello world") });
});

test("a resumed attempt refuses a changed or shortened answer without delivering anything", async () => {
  for (const tampered of ["HELLO world", "Hell"]) {
    const store = new MemoryStore();
    const state: FakeBrowser = { baseline: null, answer: { messageKey: "k1", text: "Hello" }, sends: 0 };
    const transport = transportFor(store, state);
    const first = iteratorOf(transport, "hi");
    assert.equal((await first.next()).value?.kind, "fragment");
    await first.return?.(undefined);
    state.answer = { messageKey: "k1", text: tampered };
    const resumed = await drain(transport, "hi");
    assert.deepEqual(resumed, [{ kind: "terminal", state: "uncertain", reason: "checkpoint-mismatch" }],
      "tampered answer: " + tampered);
    assert.equal(state.sends, 1);
  }
});

test("a journal write failure refuses to deliver the fragment it cannot acknowledge", async () => {
  const store = new MemoryStore();
  store.failAt = 2; // 1 = fresh attempt record, 2 = first fragment acknowledgement
  const state: FakeBrowser = { baseline: null, answer: { messageKey: "k1", text: "Hello" }, sends: 0 };
  const transport = transportFor(store, state);
  const delivered: NativeTurnEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of transport.stream(request("hi"))) delivered.push(event);
  }, /journal write failed/);
  assert.deepEqual(delivered, []);
});

test("the durable cursor advances fragment by fragment across growing answers", async () => {
  const store = new MemoryStore();
  const state: FakeBrowser = { baseline: null, answer: { messageKey: "k1", text: "A" }, sends: 0 };
  const transport = transportFor(store, state, 4);
  const iterator = iteratorOf(transport, "hi");
  assert.deepEqual((await iterator.next()).value, { kind: "fragment", text: "A" });
  assert.deepEqual((await store.read(promptPath("hi")))?.progress,
    { seq: 1, length: 1, hash: digest("A") });
  state.answer = { messageKey: "k1", text: "AB" };
  assert.deepEqual((await iterator.next()).value, { kind: "fragment", text: "B" });
  assert.deepEqual((await store.read(promptPath("hi")))?.progress,
    { seq: 2, length: 2, hash: digest("AB") });
  await iterator.return?.(undefined);
  const sequences = store.writes.map((record) => record.progress?.seq ?? null);
  assert.deepEqual(sequences, [null, null, 1, 2],
    "attempt record + adopted candidate key precede strictly increasing cursors");
});

test("a proven completion is persisted with its durable cursor, never a false one", async () => {
  const store = new MemoryStore();
  const state: FakeBrowser = {
    baseline: null, answer: { messageKey: "k1", text: "AB" }, sends: 0,
    completion: (observation) => observation.text === "AB",
  };
  const transport = transportFor(store, state);
  const events = await drain(transport, "hi");
  assert.deepEqual(fragments(events), ["AB"]);
  assert.deepEqual(events.at(-1), { kind: "terminal", state: "complete", reason: "dom-completion-proven" });
  const settled = await store.read(promptPath("hi"));
  assert.equal(settled?.state, "complete");
  assert.deepEqual(settled?.progress, { seq: 1, length: 2, hash: digest("AB") });
});

test("the file journal persists the delivery cursor and refuses a corrupted one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-durable-"));
  try {
    const store = createFileAttemptStore(dir);
    const key = "a".repeat(64);
    const record: AttemptRecord = {
      turnID: "b".repeat(32), state: "inflight", at: 1, messageKey: "k1",
      progress: { seq: 2, length: 7, hash: digest("Hello w") },
    };
    await store.write(key, record);
    assert.deepEqual(await store.read(key), record);

    const file = join(dir, ATTEMPT_FILE_PREFIX + key + ".json");
    for (const corrupted of [
      { ...record.progress, hash: "zz" },
      { ...record.progress, seq: -1 },
      { ...record.progress, length: 1.5 },
      { ...record.progress, extra: "x" },
    ]) {
      await writeFile(file, JSON.stringify({ ...record, progress: corrupted }) + "\n");
      await assert.rejects(store.read(key), /corrupt attempt record/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
