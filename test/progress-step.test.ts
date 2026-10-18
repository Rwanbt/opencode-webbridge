/** Offline proof of the shared transport's correlation/finality invariants.
 * These run on every platform (no browser, no CDP): the same step logic used by
 * the G175 browser loop is exercised directly, so cancellation/revocation free
 * semantics, message replacement, answer rewrites, monotonic fragments and
 * chunking cannot silently regress. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  PROGRESS_CHUNK, emptyProgressState, nextProgressStep, type ProgressState,
} from "../src/runtime/progress-step.js";

const stateOf = (step: ReturnType<typeof nextProgressStep>): ProgressState => {
  assert.equal(step.kind, "fragments");
  return step.kind === "fragments" ? step.state : emptyProgressState;
};

test("the first snapshot emits the whole text once and marks the message found", () => {
  const step = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "Hello" });
  assert.equal(step.kind, "fragments");
  if (step.kind !== "fragments") return;
  assert.deepEqual(step.fragments, ["Hello"]);
  assert.deepEqual(step.state, { previous: "Hello", seq: 1, found: true });
});

test("later snapshots emit only the strictly appended delta with increasing seq", () => {
  const first = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "Hello" });
  const second = nextProgressStep("m1", stateOf(first), { messageKey: "m1", text: "Hello world" });
  assert.equal(second.kind, "fragments");
  if (second.kind !== "fragments" || first.kind !== "fragments") return;
  assert.deepEqual(second.fragments, [" world"]);
  assert.equal(second.state.seq, first.state.seq + 1);
  assert.equal(second.state.previous, "Hello world");
});

test("a still-absent message before observation is not a terminal step", () => {
  const step = nextProgressStep("m1", emptyProgressState, null);
  assert.equal(step.kind, "fragments");
  if (step.kind !== "fragments") return;
  assert.deepEqual(step.fragments, []);
  assert.deepEqual(step.state, emptyProgressState);
});

test("a selected message that disappears after observation terminates message-replaced", () => {
  const found = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "A" });
  const step = nextProgressStep("m1", stateOf(found), null);
  assert.deepEqual(step, { kind: "terminal", reason: "message-replaced" });
});

test("a snapshot of another selected message terminates message-replaced, before and after observation", () => {
  assert.deepEqual(nextProgressStep("m1", emptyProgressState, { messageKey: "m2", text: "B" }),
    { kind: "terminal", reason: "message-replaced" });
  const found = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "A" });
  assert.deepEqual(nextProgressStep("m1", stateOf(found), { messageKey: "m2", text: "A" }),
    { kind: "terminal", reason: "message-replaced" });
});

test("a non-append-only rewrite terminates answer-rewritten instead of replacing deltas", () => {
  const found = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "First" });
  const state = stateOf(found);
  assert.deepEqual(nextProgressStep("m1", state, { messageKey: "m1", text: "Rewritten" }),
    { kind: "terminal", reason: "answer-rewritten" });
  assert.deepEqual(nextProgressStep("m1", state, { messageKey: "m1", text: "Fir" }),
    { kind: "terminal", reason: "answer-rewritten" });
});

test("large deltas are chunked with strictly increasing sequence numbers and lossless text", () => {
  const big = "x".repeat(PROGRESS_CHUNK * 2 + 5);
  const step = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: big });
  assert.equal(step.kind, "fragments");
  if (step.kind !== "fragments") return;
  assert.equal(step.fragments.length, 3);
  assert.deepEqual(step.fragments.map((fragment) => fragment.length), [PROGRESS_CHUNK, PROGRESS_CHUNK, 5]);
  assert.equal(step.state.seq, 3);
  assert.equal(step.fragments.join(""), big);
});

test("an empty delta advances found without emitting a fragment", () => {
  const step = nextProgressStep("m1", emptyProgressState, { messageKey: "m1", text: "" });
  assert.equal(step.kind, "fragments");
  if (step.kind !== "fragments") return;
  assert.deepEqual(step.fragments, []);
  assert.deepEqual(step.state, { previous: "", seq: 0, found: true });
});

test("an invalid chunk size is refused instead of silently emitting nothing", () => {
  for (const chunk of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => nextProgressStep("m1", emptyProgressState,
      { messageKey: "m1", text: "A" }, chunk), /chunk size/);
});

test("states are never mutated in place: a frozen previous state stays intact", () => {
  const state: ProgressState = Object.freeze({ previous: "A", seq: 1, found: true });
  const step = nextProgressStep("m1", state, { messageKey: "m1", text: "AB" });
  assert.equal(step.kind, "fragments");
  assert.deepEqual(state, { previous: "A", seq: 1, found: true });
  if (step.kind !== "fragments") return;
  assert.notEqual(step.state, state);
  assert.deepEqual(step.state, { previous: "AB", seq: 2, found: true });
});
