/** Security governance of the native turn transport: bounded turn budget,
 *  fail-closed concurrency, released leases, and redacted diagnostics. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { NATIVE_GOVERNANCE_DEFAULTS, governedNativeTransport, redactDiagnostic } from "../src/native/governed-transport.js";
import type { NativeTurnEvent, NativeTurnRequest, NativeTurnTransport } from "../src/native/turn-transport.js";

const request = (prompt = "hi"): NativeTurnRequest =>
  ({ providerID: "p", modelID: "m", prompt, signal: new AbortController().signal });
const drain = async (transport: NativeTurnTransport, prompt = "hi") => {
  const events: NativeTurnEvent[] = [];
  for await (const event of transport.stream(request(prompt))) events.push(event);
  return events;
};
const inner = (counter: { calls: number }, events: readonly NativeTurnEvent[]): NativeTurnTransport => ({
  async *stream() { counter.calls += 1; for (const event of events) yield event; },
});
const DONE: NativeTurnEvent = { kind: "terminal", state: "uncertain", reason: "inner-done" };

test("the turn budget refuses without touching the browser once exhausted, and recovers after the window", async () => {
  const counter = { calls: 0 };
  const clock = { now: 0 };
  const governed = governedNativeTransport(inner(counter, [DONE]), {
    maxTurnsPerWindow: 2, windowMs: 1_000, maxConcurrentTurns: 1, now: () => clock.now,
  });
  assert.deepEqual(await drain(governed), [DONE]);
  assert.deepEqual(await drain(governed), [DONE]);
  assert.deepEqual(await drain(governed), [{
    kind: "terminal", state: "uncertain", reason: "governance-rate-exceeded",
  }]);
  assert.equal(counter.calls, 2, "a refused turn never reaches the browser transport");
  clock.now = 2_000;
  assert.deepEqual(await drain(governed), [DONE], "the sliding window frees the budget");
  assert.equal(counter.calls, 3);
});

test("an already-running turn refuses a concurrent one instead of overlapping browser effects", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const blocking: NativeTurnTransport = {
    async *stream() { await gate; yield DONE; },
  };
  const governed = governedNativeTransport(blocking, {
    maxTurnsPerWindow: 5, windowMs: 1_000, maxConcurrentTurns: 1,
  });
  const first = drain(governed);
  assert.deepEqual(await drain(governed), [{
    kind: "terminal", state: "uncertain", reason: "governance-concurrency-exceeded",
  }]);
  release();
  assert.deepEqual(await first, [DONE]);
  assert.deepEqual(await drain(governed), [DONE], "the lease is released when the first turn ends");
});

test("a failed turn never wedges the budget: its lease is released", async () => {
  let fail = true;
  const flaky: NativeTurnTransport = {
    async *stream() {
      if (fail) { fail = false; throw new Error("transport exploded"); }
      yield DONE;
    },
  };
  const governed = governedNativeTransport(flaky, {
    maxTurnsPerWindow: 5, windowMs: 1_000, maxConcurrentTurns: 1,
  });
  await assert.rejects(drain(governed), /transport exploded/);
  assert.deepEqual(await drain(governed), [DONE], "a failure releases the concurrency lease");
});

test("every surfaced diagnostic is redacted: bearer tokens, credentials and opaque hex secrets", () => {
  const bearer = redactDiagnostic(new Error("send failed: Bearer abcdefghijklmnopqrstuvwxyz012345"));
  assert.doesNotMatch(bearer.message, /abcdefghijklmnopqrstuvwxyz012345/);
  assert.match(bearer.message, /Bearer \[REDACTED\]/);
  const hex = "f".repeat(64);
  const opaque = redactDiagnostic(new Error("record " + hex + " rejected"));
  assert.doesNotMatch(opaque.message, new RegExp(hex));
  assert.match(opaque.message, /\[REDACTED_HEX\]/);
  const credentials = redactDiagnostic(new Error("opening https://user:pass@example.test/ was refused"));
  assert.doesNotMatch(credentials.message, /user:pass/);
  assert.match(credentials.message, /https:\/\/\[REDACTED\]@/);
  const cookie = redactDiagnostic(new Error("cookie: session=private-value"));
  assert.doesNotMatch(cookie.message, /private-value/);
  assert.equal(redactDiagnostic(new Error("plain refusal")).name, "Error",
    "the error name is preserved for diagnostics");
});

test("the governed transport redacts an error thrown by the wrapped transport", async () => {
  const throwing: NativeTurnTransport = {
    async *stream() { throw new Error("refused: Bearer abcdefghijklmnopqrstuvwxyz"); },
  };
  const governed = governedNativeTransport(throwing, NATIVE_GOVERNANCE_DEFAULTS);
  await assert.rejects(drain(governed), (error: Error) => {
    assert.doesNotMatch(error.message, /abcdefghijklmnopqrstuvwxyz/);
    assert.match(error.message, /Bearer \[REDACTED\]/);
    return true;
  });
});

test("the default governance is bounded and explicit", () => {
  assert.equal(NATIVE_GOVERNANCE_DEFAULTS.maxTurnsPerWindow, 30);
  assert.equal(NATIVE_GOVERNANCE_DEFAULTS.windowMs, 60_000);
  assert.equal(NATIVE_GOVERNANCE_DEFAULTS.maxConcurrentTurns, 1);
  assert.equal(Object.isFrozen(NATIVE_GOVERNANCE_DEFAULTS), true);
});
