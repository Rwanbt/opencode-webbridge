/** Unit evidence for the five-provider adapter registry and the read-only
 *  observe operator:
 *  - the registry covers exactly the shared catalog, single-sources origins and
 *    never upgrades a capability (chatgpt is the only declared send primitive,
 *    no provider proves DOM completion, qwen stays a NO-GO probe);
 *  - unknown ids are refused loudly and never defaulted;
 *  - the operator invocation refuses malformed, duplicate or non-loopback
 *    inputs before touching anything;
 *  - discovery refuses before any browser contact when impossible (qwen) or
 *    revoked, and an unreachable endpoint never reads assistant text;
 *  - the shipped operator refuses piped/unattended execution.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { WEB_PROVIDER_CATALOG } from "../src/catalog.js";
import {
  PROVIDER_ADAPTERS, PROVIDER_ADAPTER_IDS, requireProviderAdapter, sendPrimitiveOf,
} from "../src/providers/provider-adapters.js";
import {
  parseObserveInvocation, discoverProviderAssistant, observeProviderAssistant,
  type ObserveConsent,
} from "../src/runtime/observe-provider.js";

test("the adapter registry covers exactly the shared catalog with single-sourced origins", () => {
  assert.deepEqual([...PROVIDER_ADAPTER_IDS], WEB_PROVIDER_CATALOG.map((provider) => provider.id));
  assert.deepEqual(Object.keys(PROVIDER_ADAPTERS).sort(), [...PROVIDER_ADAPTER_IDS].sort());
  for (const provider of WEB_PROVIDER_CATALOG) {
    const adapter = requireProviderAdapter(provider.id);
    assert.equal(adapter.origin, provider.origin, provider.id + " origin must stay single-sourced");
    assert.equal(adapter.label, provider.name);
  }
});

test("no adapter fabricates a capability", () => {
  const senders = PROVIDER_ADAPTER_IDS.filter((id) => requireProviderAdapter(id).sendPrimitive !== null);
  assert.deepEqual(senders, ["chatgpt", "deepseek", "gemini", "qwen"]);
  for (const id of PROVIDER_ADAPTER_IDS) {
    const adapter = requireProviderAdapter(id);
    assert.equal(adapter.completionProof, "none", id + " must not claim a completion proof");
  }
  assert.equal(requireProviderAdapter("chatgpt").readPrimitive, "g157-chatgpt-cdp-observer");
  assert.equal(requireProviderAdapter("chatgpt").sendPrimitive, "g159-chatgpt-one-shot");
  assert.equal(requireProviderAdapter("deepseek").readPrimitive, "g160-other-provider-dom");
  assert.equal(requireProviderAdapter("deepseek").discoverable, true);
  assert.equal(requireProviderAdapter("deepseek").sendPrimitive, "g174-deepseek-one-shot");
  assert.equal(requireProviderAdapter("gemini").readPrimitive, "g160-other-provider-dom");
  assert.equal(requireProviderAdapter("gemini").discoverable, true);
  assert.equal(requireProviderAdapter("gemini").sendPrimitive, "g175-gemini-one-shot");
  for (const id of ["mistral"] as const) {
    const adapter = requireProviderAdapter(id);
    assert.equal(adapter.readPrimitive, "g160-other-provider-dom");
    assert.equal(adapter.discoverable, true);
    assert.equal(adapter.sendPrimitive, null);
  }
  const qwen = requireProviderAdapter("qwen");
  assert.equal(qwen.readPrimitive, "g160-other-provider-dom");
  assert.equal(qwen.discoverable, true);
  assert.equal(qwen.sendPrimitive, "g176-qwen-one-shot");
  assert.match(qwen.notes, /UNCERTAIN/);
  assert.deepEqual(
    [...PROVIDER_ADAPTER_IDS].filter((id) => requireProviderAdapter(id).discoverable).sort(),
    ["chatgpt", "deepseek", "gemini", "mistral", "qwen"]);
});

test("unknown adapters are refused and unknown capability lookups fail closed", () => {
  assert.throws(() => requireProviderAdapter("chatgpt2"), /unknown provider adapter/);
  assert.throws(() => requireProviderAdapter(""), /unknown provider adapter/);
  assert.equal(sendPrimitiveOf("chatgpt"), "g159-chatgpt-one-shot");
  assert.equal(sendPrimitiveOf("deepseek"), "g174-deepseek-one-shot");
  assert.equal(sendPrimitiveOf("gemini"), "g175-gemini-one-shot");
  assert.equal(sendPrimitiveOf("qwen"), "g176-qwen-one-shot");
  assert.equal(sendPrimitiveOf("mistral"), null);
  assert.equal(sendPrimitiveOf("no-such-provider"), null);
});

test("the invocation parser accepts exactly the strict loopback shape", () => {
  const good = ["--provider", "deepseek", "--endpoint", "http://127.0.0.1:9222",
    "--tab", "ABCD1234", "--turn", "turn-1"];
  const parsed = parseObserveInvocation(good);
  assert.deepEqual(parsed, {
    provider: "deepseek", endpoint: "http://127.0.0.1:9222", tabID: "ABCD1234", turnID: "turn-1",
  });
  const full = parseObserveInvocation([...good, "--message", "msg:1", "--polls", "4"]);
  assert.equal(full.messageKey, "msg:1");
  assert.equal(full.polls, 4);
  for (const bad of [
    ["--provider"],
    [...good, "--provider", "gemini"],
    [...good, "--unknown", "x"],
    good.slice(0, 2),
    ["--provider", "DeepSeek", "--endpoint", "http://127.0.0.1:9222", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "http://192.168.0.10:9222", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "https://127.0.0.1:9222", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "http://user:pass@127.0.0.1:9222", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "http://127.0.0.1:9222/json", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "http://127.0.0.1:0", "--tab", "ABCD1234", "--turn", "t"],
    ["--provider", "deepseek", "--endpoint", "http://127.0.0.1:9222", "--tab", "AB", "--turn", "t"],
    [...good, "--polls", "33"],
    [...good, "--polls", "0"],
    [...good, "--message", ""],
  ]) {
    assert.throws(() => parseObserveInvocation(bad), Error, JSON.stringify(bad));
  }
});

test("the request gate refuses incomplete consent, unknown ids and non-loopback endpoints first", async () => {
  const consent: ObserveConsent = {
    userDeclaresBrowserOwnership: true,
    approve: async () => true,
    allowAssistantText: async () => true,
    isStillApproved: () => true,
  };
  const base = {
    provider: "deepseek", endpoint: "http://127.0.0.1:9", tabID: "ABCD1234",
    turnID: "turn-1", consent, signal: new AbortController().signal,
  };
  await assert.rejects(discoverProviderAssistant({ ...base, provider: "nope" }), /unknown provider adapter/);
  await assert.rejects(discoverProviderAssistant({ ...base, endpoint: "http://192.168.0.10:9222" }),
    /local CDP endpoint required/);
  await assert.rejects(discoverProviderAssistant({ ...base, endpoint: "https://127.0.0.1:9222" }),
    /local CDP endpoint required/);
  await assert.rejects(discoverProviderAssistant({ ...base, tabID: "AB" }), /explicit CDP tab id/);
  await assert.rejects(observeProviderAssistant(base).next(), /confirmed assistant message key/);
  const malformed = { ...consent, approve: "yes" } as unknown as ObserveConsent;
  await assert.rejects(discoverProviderAssistant({ ...base, consent: malformed }),
    /explicit host ownership, per-read approval and revocation checks are required/);
});

test("qwen discovery is now wired; observation without a message key is refused", async () => {
  const consent: ObserveConsent = {
    userDeclaresBrowserOwnership: true,
    approve: async () => true,
    allowAssistantText: async () => true,
    isStillApproved: () => true,
  };
  const base = {
    provider: "qwen", endpoint: "http://127.0.0.1:9", tabID: "ABCD1234",
    turnID: "turn-1", consent, signal: new AbortController().signal,
  };
  await assert.rejects(discoverProviderAssistant(base));
  await assert.rejects(observeProviderAssistant({ ...base, provider: "gemini" }).next(),
    /confirmed assistant message key/);
});

test("a revoked approval refuses before any browser contact", async () => {
  let approved = false;
  const consent: ObserveConsent = {
    userDeclaresBrowserOwnership: true,
    approve: async () => true,
    allowAssistantText: async () => { approved = true; return true; },
    isStillApproved: () => false,
  };
  const base = {
    provider: "deepseek", endpoint: "http://127.0.0.1:9", tabID: "ABCD1234",
    turnID: "turn-1", consent, signal: new AbortController().signal,
  };
  await assert.rejects(discoverProviderAssistant(base), /revoked before any browser contact/);
  assert.equal(approved, false);
});

test("an unreachable loopback endpoint refuses discovery without reading assistant text", async () => {
  const port = await freePort();
  let reads = 0;
  const consent: ObserveConsent = {
    userDeclaresBrowserOwnership: true,
    approve: async () => true,
    allowAssistantText: async () => { reads += 1; return true; },
    isStillApproved: () => true,
  };
  await assert.rejects(discoverProviderAssistant({
    provider: "deepseek", endpoint: "http://127.0.0.1:" + port, tabID: "ABCD1234",
    turnID: "turn-1", consent, signal: new AbortController().signal,
  }), /fetch failed|G155 CDP denied/);
  assert.equal(reads, 0, "no assistant read may happen without a reachable declared tab");
});

const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const address = server.address() as { port: number };
  await new Promise<void>((ok) => server.close(() => ok()));
  return address.port;
};

test("the shipped observe operator refuses piped or unattended execution", () => {
  const bin = resolve("bin", "webbridge-manual-observe.mjs");
  const result = spawnSync(process.execPath, [bin, "--provider", "deepseek",
    "--endpoint", "http://127.0.0.1:9222", "--tab", "ABCD1234", "--turn", "turn-1"],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /interactive terminal required/);
});
