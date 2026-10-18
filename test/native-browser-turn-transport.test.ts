/** Unit evidence for the consented browser-turn transport: no second send on a
 *  retry, no adoption of a previous answer, and no completion without a proven
 *  signal. All browser behavior is a fake here; the real CDP primitives stay
 *  behind explicit user consent. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  BrowserTurnRefusedError, BrowserTurnUncertainError, MAX_PROMPT_CHARS, createBrowserTurnTransport,
} from "../src/native/browser-turn-transport.js";
import type {
  AttemptRecord, AttemptStore, BrowserTurnAttachment, BrowserTurnObservation,
} from "../src/native/browser-turn-transport.js";
import type { NativeTurnEvent, NativeTurnRequest } from "../src/native/turn-transport.js";

const REQUEST: NativeTurnRequest = {
  providerID: "webbridge-chatgpt", modelID: "chatgpt-web",
  prompt: "explain the failing test", signal: new AbortController().signal,
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

class MemoryStore implements AttemptStore {
  private readonly records = new Map<string, AttemptRecord>();
  reads = 0;
  writes: AttemptRecord[] = [];
  discards = 0;
  async read(key: string) { this.reads += 1; return this.records.get(key); }
  async write(key: string, record: AttemptRecord) {
    this.records.set(key, record);
    this.writes.push(record);
  }
  async discard(key: string) { this.discards += 1; this.records.delete(key); }
  snapshot() { return [...this.records.values()]; }
}

interface Calls {
  sends: Array<{ prompt: string; turnID: string }>;
  samples: number;
  closes: number;
}

interface FakeOptions {
  readonly baseline?: BrowserTurnObservation | null;
  readonly identity?: { readonly tabID: string; readonly generation: number };
  readonly samples: ReadonlyArray<BrowserTurnObservation | null | Error>;
  readonly completion?: (observation: BrowserTurnObservation) => boolean;
  readonly onSend?: () => Promise<void> | void;
}

function fakeAttachment(options: FakeOptions, calls: Calls) {
  let index = 0;
  const attachment: BrowserTurnAttachment = {
    identity: options.identity ?? { tabID: "tab12345", generation: 1 },
    baseline: options.baseline ?? null,
    get completion() { return options.completion; },
    async send(prompt: string, turnID: string) {
      calls.sends.push({ prompt, turnID });
      await options.onSend?.();
    },
    async sample() {
      calls.samples += 1;
      const entry = options.samples[Math.min(index, options.samples.length - 1)] ?? null;
      index += 1;
      if (entry instanceof Error) throw entry;
      return entry;
    },
    async close() { calls.closes += 1; },
  };
  return attachment;
}

async function collect(transport: { stream(request: NativeTurnRequest): AsyncIterable<NativeTurnEvent> },
  request: NativeTurnRequest = REQUEST) {
  const events: NativeTurnEvent[] = [];
  for await (const event of transport.stream(request)) events.push(event);
  return events;
}

const fragments = (events: NativeTurnEvent[]) =>
  events.filter((event) => event.kind === "fragment").map((event) => (event as { text: string }).text);
const terminal = (events: NativeTurnEvent[]) => events.at(-1) as
  { kind: "terminal"; state: string; reason: string };

/** One script per attach() call: a retry attaches again and drives its own script. */
const build = (options: FakeOptions | FakeOptions[], store = new MemoryStore(), extra = {}) => {
  const scripts = Array.isArray(options) ? options : [options];
  const calls: Calls = { sends: [], samples: 0, closes: 0 };
  let call = 0;
  const transport = createBrowserTurnTransport({
    providerID: REQUEST.providerID, modelID: REQUEST.modelID,
    attach: async () => fakeAttachment(scripts[Math.min(call++, scripts.length - 1)]!, calls),
    store, intervalMs: 20, polls: 4, ...extra,
  });
  return { transport, store, calls };
};

test("a streaming answer becomes fragments and an honest uncertain terminal", async () => {
  const { transport, store, calls } = build({
    baseline: { messageKey: "m1", text: "previous answer" },
    samples: [null, { messageKey: "m2", text: "Hel" }, { messageKey: "m2", text: "Hello" }],
  });
  const events = await collect(transport);
  assert.deepEqual(fragments(events), ["Hel", "lo"], "progressive text must be delivered as deltas");
  assert.deepEqual(terminal(events), {
    kind: "terminal", state: "uncertain", reason: "provider-finality-unverified",
  }, "DOM silence is never a completion");
  assert.equal(calls.sends.length, 1);
  assert.equal(calls.closes, 1);
  assert.deepEqual(store.snapshot(), [{
    turnID: calls.sends[0]!.turnID, state: "uncertain", at: store.writes.at(-1)!.at,
    messageKey: "m2", progress: { seq: 2, length: 5, hash: digest("Hello") },
    scope: { tabID: "tab12345", generation: 1 },
  }]);
});

test("the answer present before the send is never adopted as our answer", async () => {
  const { transport, calls } = build({
    baseline: { messageKey: "m1", text: "previous answer" },
    samples: [{ messageKey: "m1", text: "previous answer" }],
  });
  const events = await collect(transport);
  assert.deepEqual(fragments(events), []);
  assert.deepEqual(terminal(events), {
    kind: "terminal", state: "uncertain", reason: "no-new-candidate",
  });
  assert.equal(calls.sends.length, 1);
});

test("a retry re-observes the same browser turn instead of sending again", async () => {
  const { transport, store, calls } = build([
    {
      baseline: { messageKey: "m1", text: "previous answer" },
      samples: [null, { messageKey: "m2", text: "Hello" },
        { messageKey: "m2", text: "Hello world" }],
    },
    {
      baseline: { messageKey: "m1", text: "previous answer" },
      samples: [{ messageKey: "m2", text: "Hello world" },
        { messageKey: "m2", text: "Hello world!" }],
    },
  ]);
  await collect(transport);
  const sentBefore = calls.sends.length;
  const retry = await collect(transport);
  assert.equal(sentBefore, 1);
  assert.equal(calls.sends.length, 1, "a retry must never issue a second browser send");
  assert.deepEqual(fragments(retry), ["!"],
    "the retry resumes after the durably acknowledged prefix instead of replaying it");
  assert.deepEqual(terminal(retry), {
    kind: "terminal", state: "uncertain", reason: "provider-finality-unverified",
  });
  assert.equal(store.snapshot().length, 1);
});

test("an attempt that never observed a candidate is refused on retry, not guessed", async () => {
  const { transport, calls } = build({ baseline: null, samples: [null] });
  await collect(transport);
  const retry = await collect(transport);
  assert.equal(calls.sends.length, 1, "the first attempt already consumed the browser turn");
  assert.deepEqual(terminal(retry), {
    kind: "terminal", state: "uncertain", reason: "reconciled-attempt-without-observation",
  });
});

test("a completed prompt may be sent again deliberately, with a new turn", async () => {
  const store = new MemoryStore();
  await store.write("seed", { turnID: "seed", state: "inflight", at: 0 });
  const { transport, calls } = build({
    baseline: { messageKey: "m1", text: "previous answer" },
    samples: [{ messageKey: "m2", text: "done" }],
    completion: () => true,
  }, store);
  const first = await collect(transport);
  assert.deepEqual(terminal(first), {
    kind: "terminal", state: "complete", reason: "dom-completion-proven",
  });
  const second = await collect(transport);
  assert.equal(calls.sends.length, 2, "a proven-complete attempt does not block a new turn");
  assert.notEqual(calls.sends[0]!.turnID, calls.sends[1]!.turnID);
  assert.equal(terminal(second).state, "complete");
});

test("outside the reconcile window an unfinished attempt becomes a new turn", async () => {
  const store = new MemoryStore();
  const { transport, calls } = build({
    baseline: null, samples: [{ messageKey: "m2", text: "answer" }],
  }, store, { now: () => 0, reconcileWindowMs: 1_000 });
  await collect(transport);
  assert.equal(calls.sends.length, 1);
  const later = build({
    baseline: null, samples: [{ messageKey: "m3", text: "second answer" }],
  }, store, { now: () => 600_000, reconcileWindowMs: 1_000 });
  const events = await collect(later.transport);
  assert.equal(later.calls.sends.length, 1, "after the bounded window a new turn may send");
  assert.deepEqual(fragments(events), ["second answer"]);
});

test("a refusal before any UI effect discards the attempt so a later call may send", async () => {
  const { transport, store, calls } = build([
    {
      baseline: null, samples: [],
      onSend: () => { throw new BrowserTurnRefusedError("composer busy"); },
    },
    { baseline: null, samples: [{ messageKey: "m2", text: "answer" }] },
  ]);
  await assert.rejects(async () => { await collect(transport); }, /composer busy/);
  assert.equal(store.discards, 1, "no browser turn happened: the attempt record must be discarded");
  assert.equal(store.snapshot().length, 0);
  const second = await collect(transport);
  assert.equal(calls.sends.length, 2, "a clean refusal must not block a legitimate retry");
  assert.deepEqual(fragments(second), ["answer"], "the later call really sends and streams");
  assert.equal(terminal(second).state, "uncertain");
});

test("an uncertain send is recorded and never replayed", async () => {
  const { transport, store, calls } = build({
    baseline: null, samples: [],
    onSend: () => { throw new BrowserTurnUncertainError("click effect unknown"); },
  });
  const first = await collect(transport);
  assert.deepEqual(terminal(first), {
    kind: "terminal", state: "uncertain", reason: "send-uncertain",
  });
  const retry = await collect(transport);
  assert.equal(calls.sends.length, 1, "an uncertain send must never be replayed");
  assert.deepEqual(terminal(retry), {
    kind: "terminal", state: "uncertain", reason: "reconciled-attempt-without-observation",
  });
  assert.equal(store.snapshot()[0]!.state, "uncertain");
});

test("a replaced or rewritten candidate ends the turn as uncertain", async () => {
  const replaced = build({
    baseline: null,
    samples: [{ messageKey: "m2", text: "partial" }, { messageKey: "m3", text: "another" }],
  });
  assert.deepEqual(terminal(await collect(replaced.transport)), {
    kind: "terminal", state: "uncertain", reason: "candidate-replaced-or-rewritten",
  });
  const rewritten = build({
    baseline: null,
    samples: [{ messageKey: "m2", text: "partial" }, { messageKey: "m2", text: "restart" }],
  });
  assert.deepEqual(terminal(await collect(rewritten.transport)), {
    kind: "terminal", state: "uncertain", reason: "candidate-rewritten",
  });
});

test("a revoked read ends the turn as uncertain without inventing an answer", async () => {
  const { transport } = build({
    baseline: null,
    samples: [new Error("G157 assistant text permission revoked")],
  });
  const events = await collect(transport);
  assert.deepEqual(fragments(events), []);
  assert.deepEqual(terminal(events), {
    kind: "terminal", state: "uncertain", reason: "read-revoked-or-document-changed",
  });
});

test("cancellation is reported as cancelled, never as a completion", async () => {
  const controller = new AbortController();
  const { transport } = build({
    baseline: null,
    samples: [null, null, null, null],
    onSend: () => controller.abort(),
  });
  const events = await collect(transport, { ...REQUEST, signal: controller.signal });
  assert.deepEqual(terminal(events), {
    kind: "terminal", state: "cancelled", reason: "cancelled-before-terminal",
  });
});

test("completion requires an explicit proof; a present proof is the only path to complete", async () => {
  const withoutProof = build({ baseline: null, samples: [{ messageKey: "m2", text: "answer" }] });
  assert.equal(terminal(await collect(withoutProof.transport)).state, "uncertain");
  const seen: BrowserTurnObservation[] = [];
  const withProof = build({
    baseline: null, samples: [{ messageKey: "m2", text: "answer" }],
    completion: (observation) => { seen.push(observation); return observation.text.endsWith("answer"); },
  });
  assert.deepEqual(terminal(await collect(withProof.transport)), {
    kind: "terminal", state: "complete", reason: "dom-completion-proven",
  });
  assert.equal(seen.length, 1, "the proof is asked about the concrete observation only");
});

test("a resumed attempt refuses a replaced tab or generation instead of adopting its text", async () => {
  const store = new MemoryStore();
  const first = build({
    baseline: null, identity: { tabID: "tab12345", generation: 1 },
    samples: [{ messageKey: "m2", text: "Hello" }],
  }, store);
  await collect(first.transport);
  assert.deepEqual(first.store.snapshot()[0]!.scope, { tabID: "tab12345", generation: 1 });

  for (const identity of [{ tabID: "tab99999", generation: 1 }, { tabID: "tab12345", generation: 2 }]) {
    const moved = build({
      baseline: null, identity,
      samples: [{ messageKey: "m2", text: "Hello world" }],
    }, store);
    const events = await collect(moved.transport);
    assert.deepEqual(fragments(events), [], JSON.stringify(identity));
    assert.deepEqual(terminal(events), {
      kind: "terminal", state: "uncertain", reason: "scope-changed",
    }, JSON.stringify(identity));
    assert.equal(moved.calls.sends.length, 0, "a refused scope must never send again");
  }
  const kept = store.snapshot();
  assert.deepEqual(kept[0]!.scope, { tabID: "tab12345", generation: 1 },
    "the refusal keeps the original recorded scope as evidence");
});

test("crash after the first durable fragment retains tab generation and refuses cross-tab resume", async () => {
  const store = new MemoryStore();
  const first = build({ identity: { tabID: "tab12345", generation: 7 }, baseline: null,
    samples: [{ messageKey: "m2", text: "in-progress" }] }, store);
  // Simulate a consumer process disappearing directly after receiving its first fragment:
  // no terminal settle() may repair the intermediate checkpoint.
  const stream = first.transport.stream(REQUEST)[Symbol.asyncIterator]();
  const emitted = await stream.next();
  assert.deepEqual(emitted.value, { kind: "fragment", text: "in-progress" });
  assert.deepEqual(store.snapshot()[0]!.scope, { tabID: "tab12345", generation: 7 },
    "each durable fragment must retain the original authorized browser scope");
  await stream.return?.();
  const resumed = build({ identity: { tabID: "tab99999", generation: 8 }, baseline: null,
    samples: [{ messageKey: "m2", text: "in-progress forged" }] }, store);
  const events = await collect(resumed.transport);
  assert.deepEqual(fragments(events), []);
  assert.deepEqual(terminal(events), { kind: "terminal", state: "uncertain", reason: "scope-changed" });
  assert.equal(resumed.calls.sends.length, 0);
});

test("an oversized prompt is refused before any attach, and the exact bound is accepted", async () => {
  const { transport, calls, store } = build({
    baseline: null, samples: [{ messageKey: "m2", text: "answer" }],
  });
  await assert.rejects(
    collect(transport, { ...REQUEST, prompt: "x".repeat(MAX_PROMPT_CHARS + 1) }),
    /prompt exceeds the reviewed bound/);
  assert.equal(calls.sends.length, 0, "no browser effect may happen for a refused prompt");
  assert.equal(store.snapshot().length, 0, "a refused prompt leaves no durable attempt");

  const accepted = await collect(transport, {
    ...REQUEST, prompt: "x".repeat(MAX_PROMPT_CHARS),
  });
  assert.equal(terminal(accepted).state, "uncertain");
  assert.equal(calls.sends.length, 1, "the exact reviewed bound is still a legitimate prompt");
});

test("time and frequency budgets are explicit and refuse invalid values at construction", () => {
  for (const extra of [
    { polls: 0 }, { polls: 65 },
    { intervalMs: 10 }, { intervalMs: 2_500 },
    { reconcileWindowMs: 0 }, { reconcileWindowMs: 3_600_001 },
  ]) {
    assert.throws(() => build({ baseline: null, samples: [] }, new MemoryStore(), extra),
      /invalid bounded budget/, JSON.stringify(extra));
  }
  const accepted = build({ baseline: null, samples: [] }, new MemoryStore(),
    { polls: 1, intervalMs: 20, reconcileWindowMs: 1_000 });
  assert.ok(accepted.transport, "the exact reviewed bounds are accepted");
});

test("long answers are chunked and an empty prompt is refused", async () => {
  const long = "x".repeat(5_000);
  const { transport } = build({ baseline: null, samples: [{ messageKey: "m2", text: long }] });
  const chunks = fragments(await collect(transport));
  assert.deepEqual(chunks.map((chunk) => chunk.length), [4096, 904]);
  await assert.rejects(async () => {
    await collect(transport, { ...REQUEST, prompt: "   " });
  }, /empty prompt refused/);
});

test("an unreachable browser discards a fresh attempt so a later call may still send", async () => {
  const store = new MemoryStore();
  const calls: Calls = { sends: [], samples: 0, closes: 0 };
  let attaches = 0;
  const transport = createBrowserTurnTransport({
    providerID: REQUEST.providerID, modelID: REQUEST.modelID,
    store, intervalMs: 20, polls: 4,
    attach: async () => {
      attaches += 1;
      if (attaches === 1) throw new Error("declared endpoint unreachable");
      return fakeAttachment({ baseline: null, samples: [{ messageKey: "m2", text: "answer" }] }, calls);
    },
  });
  await assert.rejects(async () => { await collect(transport); }, /unreachable/);
  assert.equal(store.discards, 1, "attach precedes every UI effect: the fresh attempt is discarded");
  assert.equal(store.snapshot().length, 0, "no attempt record may outlive an attach that sent nothing");
  const second = await collect(transport);
  assert.equal(calls.sends.length, 1, "the later call really sends");
  assert.deepEqual(fragments(second), ["answer"]);
  assert.equal(terminal(second).state, "uncertain");
});

test("a reconciled attempt keeps its record when the browser is gone", async () => {
  const store = new MemoryStore();
  const { transport, calls } = build({
    baseline: null, samples: [{ messageKey: "m2", text: "answer" }],
  }, store);
  await collect(transport); // records the attempt (it really sent once)
  assert.equal(calls.sends.length, 1);
  const gone = createBrowserTurnTransport({
    providerID: REQUEST.providerID, modelID: REQUEST.modelID,
    store, intervalMs: 20, polls: 4,
    attach: async () => { throw new Error("browser closed"); },
  });
  await assert.rejects(async () => { await collect(gone); }, /browser closed/);
  assert.equal(store.discards, 0, "a reconciled attempt must never be discarded: its send may have landed");
  assert.equal(store.snapshot().length, 1);
});
