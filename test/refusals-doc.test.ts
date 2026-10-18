/** The refusal catalogue is executable documentation.
 *
 *  Every marker it lists must exist literally in the native sources: a refusal
 *  cannot be removed from the code without failing this suite, and the document
 *  cannot document a refusal that does not exist. It also asserts the two
 *  security principles of the fail-closed path: no HTTP authorization header is
 *  ever consumed, and Basic credentials are never treated as identity. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const DOC = "docs/REFUSALS.fr.md";
const SOURCES = Object.freeze([
  "src/native/consented-transport.ts",
  "src/native/consented-cdp-attachment.ts",
  "src/native/attempt-store.ts",
  "src/native/browser-turn-transport.ts",
  "src/native/governed-transport.ts",
  "src/native/journal-operator.ts",
  "src/native/web-model.ts",
  "src/browser/explicit-cdp-read.ts",
]);
const read = (file: string) => readFile(join(ROOT, file), "utf8");
/** Only the FIRST cell of a markdown table row is a marker. */
const documentedMarkers = (doc: string): string[] => {
  const markers: string[] = [];
  for (const line of doc.split(/\r?\n/)) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match) markers.push(match[1]!);
  }
  return markers;
};

test("every documented refusal marker exists literally in the native sources", async () => {
  const markers = documentedMarkers(await read(DOC));
  assert.ok(markers.length >= 30, "the catalogue must keep the full native refusal set");
  assert.equal(new Set(markers).size, markers.length, "no duplicate markers in the catalogue");
  const sources = await Promise.all(SOURCES.map(async (file) => [file, await read(file)] as const));
  const missing = markers.filter((marker) => !sources.some(([, text]) => text.includes(marker)));
  assert.deepEqual(missing, [], "documented markers absent from the code: update code or catalogue");
});

test("the catalogue keeps the decisive refusals documented", async () => {
  const markers = documentedMarkers(await read(DOC));
  for (const required of [
    "empty prompt refused", "prompt exceeds the reviewed bound", "invalid bounded budget",
    "checkpoint-mismatch", "scope-changed", "send-uncertain", "governance-",
    "corrupt attempt record", "has no consented send primitive yet",
    "dom-completion-proven", "webbridge-terminal-uncertain", "must be an explicit loopback",
  ]) assert.ok(markers.includes(required), "the catalogue must document: " + required);
});

test("the catalogue states the non-negotiable principles and the isolated upstream limit", async () => {
  const doc = await read(DOC);
  for (const phrase of [
    "Aucun repli silencieux", "donnée non fiable", "Basic n'est jamais une identité",
    "Fail-closed sans veto artificiel", "sessionID", "plugin-provided-language-model.fr.md",
  ]) assert.ok(doc.includes(phrase), "the catalogue must state: " + phrase);
});

test("no HTTP authorization authority exists in the native path", async () => {
  for (const file of SOURCES) {
    const text = await read(file);
    assert.doesNotMatch(text, /Authorization/,
      file + ": no HTTP authorization header may ever be consumed");
    assert.doesNotMatch(text, /\bBasic\s+[A-Za-z0-9+/=]{8,}/,
      file + ": Basic credentials are never identity");
  }
});
