/** Unit evidence for the native WebBridge model: honest terminals, explicit
 * refusal without a session, local handling of core auxiliary calls, and a
 * fail-closed anchor module. Browser behavior itself is covered by the CLI
 * fixture test and the future consented CDP transport. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { createWebBridgeNativeAnchor } from "../src/native/provider-anchor.js";
import { FIXTURE_MARKER, fixtureTransport } from "../src/native/fixture-transport.js";
import { isTitleGeneration, lastUserText, localTitle } from "../src/native/prompt.js";
import { nativeWebModelConfig, NATIVE_WEB_PROVIDERS } from "../src/native/registration.js";
import {
  AUX_TITLE_RAW, DOM_COMPLETE_RAW, TERMINAL_UNCERTAIN_RAW, createWebLanguageModel,
} from "../src/native/web-model.js";
import type { NativeTurnEvent, NativeTurnTransport } from "../src/native/turn-transport.js";

const TOKEN = "a".repeat(64);
const MODEL_OPTIONS = {
  providerID: "webbridge-chatgpt", modelID: "chatgpt-web",
  providerName: "ChatGPT", origin: "https://chatgpt.com", fixture: false,
};

const call = (text = "explain the failing test"): LanguageModelV3CallOptions => ({
  prompt: [{ role: "user", content: [{ type: "text" as const, text }] }],
});

const titleCall = (text: string): LanguageModelV3CallOptions => ({
  prompt: [
    { role: "system", content: "You are a title generator. You output ONLY a thread title. Nothing else." },
    { role: "user", content: [{ type: "text" as const, text }] },
  ],
});

async function parts(stream: ReadableStream<LanguageModelV3StreamPart>): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader();
  const collected: LanguageModelV3StreamPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return collected;
    if (value) collected.push(value);
  }
}

function stubTransport(events: NativeTurnEvent[]): { transport: NativeTurnTransport; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    transport: {
      async *stream() { calls += 1; for (const event of events) yield event; },
    },
  };
}

const modelWith = (transport: NativeTurnTransport | null) =>
  createWebLanguageModel({ ...MODEL_OPTIONS, transport });

test("native model selection is dormant by default and rejects unknown providers", () => {
  assert.equal(nativeWebModelConfig({}), null);
  assert.equal(nativeWebModelConfig({ WEBBRIDGE_NATIVE_WEB_MODELS: " , " }), null);
  const config = nativeWebModelConfig({ WEBBRIDGE_NATIVE_WEB_MODELS: "chatgpt, qwen" });
  assert.deepEqual(config?.providers.map((provider) => provider.providerID), ["webbridge-chatgpt", "webbridge-qwen"]);
  assert.equal(config?.fixture, false);
  assert.throws(() => nativeWebModelConfig({ WEBBRIDGE_NATIVE_WEB_MODELS: "chatgpt,ocdx" }), /unknown provider/);
  assert.equal(NATIVE_WEB_PROVIDERS.length, 5);
  assert.ok(NATIVE_WEB_PROVIDERS.every((provider) => provider.modelID.endsWith("-web")));
});

test("prompt helpers use the last user text and keep titles bounded", () => {
  const options = call("first") as LanguageModelV3CallOptions;
  options.prompt.push({ role: "assistant", content: [{ type: "text" as const, text: "earlier answer" }] });
  options.prompt.push({ role: "user", content: [{ type: "text" as const, text: "second **question**" }] });
  assert.equal(lastUserText(options.prompt), "second **question**");
  assert.equal(isTitleGeneration(options.prompt), false);
  assert.equal(isTitleGeneration(titleCall("hi").prompt), true);
  const title = localTitle(call("https://example.invalid/x  Fix    the `stream` bug  ").prompt);
  assert.equal(title, "Fix the stream bug");
  assert.ok(localTitle(call("x".repeat(400)).prompt).length <= 60);
  assert.equal(localTitle(call("").prompt), "WebBridge session");
});

test("a proven DOM completion becomes stop with an explicit raw marker", async () => {
  const stub = stubTransport([
    { kind: "fragment", text: "hello " },
    { kind: "fragment", text: "world" },
    { kind: "terminal", state: "complete", reason: "fixture-complete" },
  ]);
  const result = await modelWith(stub.transport).doStream(call());
  const streamed = await parts(result.stream);
  assert.deepEqual(streamed.map((part) => part.type),
    ["stream-start", "text-start", "text-delta", "text-delta", "text-end", "finish"]);
  const finish = streamed.at(-1) as Extract<LanguageModelV3StreamPart, { type: "finish" }>;
  assert.equal(finish.finishReason.unified, "stop");
  assert.equal(finish.finishReason.raw, DOM_COMPLETE_RAW);
  assert.equal((finish.providerMetadata?.webbridge as Record<string, unknown>).terminal, "complete");
  assert.equal(stub.calls(), 1);
});

test("an unproven terminal is refused as an error, never as a completion", async () => {
  const stub = stubTransport([
    { kind: "fragment", text: "partial text" },
    { kind: "terminal", state: "uncertain", reason: "no-terminal-evidence" },
  ]);
  const result = await modelWith(stub.transport).doStream(call());
  const finish = (await parts(result.stream)).at(-1) as Extract<LanguageModelV3StreamPart, { type: "finish" }>;
  assert.equal(finish.finishReason.unified, "error");
  assert.equal(finish.finishReason.raw, TERMINAL_UNCERTAIN_RAW);
  assert.notEqual(finish.finishReason.unified, "stop");

  const generate = await modelWith(stubTransport([
    { kind: "terminal", state: "uncertain", reason: "no-terminal-evidence" },
  ]).transport).doGenerate(call());
  assert.equal(generate.finishReason.raw, TERMINAL_UNCERTAIN_RAW);
  assert.deepEqual(generate.content, []);
});

test("a transport that ends without a terminal is uncertain, not complete", async () => {
  const result = await modelWith(stubTransport([{ kind: "fragment", text: "text" }]).transport).doStream(call());
  const finish = (await parts(result.stream)).at(-1) as Extract<LanguageModelV3StreamPart, { type: "finish" }>;
  assert.equal(finish.finishReason.raw, TERMINAL_UNCERTAIN_RAW);
  assert.equal((finish.providerMetadata?.webbridge as Record<string, unknown>).reason, "transport-ended-without-terminal");
});

test("without an attached browser session the model refuses explicitly", async () => {
  const model = modelWith(null);
  await assert.rejects(Promise.resolve(model.doStream(call())), /WebBridge ChatGPT: no attached authorized browser session/);
  await assert.rejects(Promise.resolve(model.doStream(call())), /refusing to fabricate a provider answer \(https:\/\/chatgpt\.com\)/);
  await assert.rejects(Promise.resolve(model.doGenerate(call())), /no attached authorized browser session/);
});

test("core auxiliary title calls are answered locally and never reach a browser", async () => {
  const stub = stubTransport([{ kind: "terminal", state: "complete", reason: "fixture-complete" }]);
  const streamed = await parts((await modelWith(stub.transport).doStream(titleCall("Fix  the  retry loop"))).stream);
  const finish = streamed.at(-1) as Extract<LanguageModelV3StreamPart, { type: "finish" }>;
  assert.equal(finish.finishReason.raw, AUX_TITLE_RAW);
  assert.equal(finish.finishReason.unified, "stop");
  assert.equal((finish.providerMetadata?.webbridge as Record<string, unknown>).terminal, "auxiliary");
  const delta = streamed.find((part) => part.type === "text-delta") as Extract<LanguageModelV3StreamPart, { type: "text-delta" }>;
  assert.equal(delta.delta, "Fix the retry loop");
  assert.equal(stub.calls(), 0);
});

test("the anchor module refuses to answer when the plugin hook is inactive", async () => {
  const anchor = createWebBridgeNativeAnchor();
  const model = anchor.languageModel("chatgpt-web");
  await assert.rejects(model.doStream(), /language hook inactive; refusing to fabricate a response/);
  await assert.rejects(model.doGenerate(), /language hook inactive/);
});

test("the fixture transport stays authorized, labeled and observable", async () => {
  assert.equal(fixtureTransport({}), null);
  assert.throws(() => fixtureTransport({ WEBBRIDGE_NATIVE_MODEL_FIXTURE: "1" }), /64-hex token required/);
  const temp = await mkdtemp(join(tmpdir(), "webbridge-fixture-"));
  try {
    const log = join(temp, "turns.log");
    const transport = fixtureTransport({
      WEBBRIDGE_NATIVE_MODEL_FIXTURE: "1", WEBBRIDGE_NATIVE_MODEL_FIXTURE_TOKEN: TOKEN,
      WEBBRIDGE_NATIVE_MODEL_FIXTURE_STATE: "uncertain", WEBBRIDGE_NATIVE_MODEL_FIXTURE_LOG: log,
    });
    assert.ok(transport);
    const events: NativeTurnEvent[] = [];
    for await (const event of transport.stream({
      providerID: "webbridge-chatgpt", modelID: "chatgpt-web", prompt: "hello", signal: new AbortController().signal,
    })) events.push(event);
    const text = events.filter((event) => event.kind === "fragment").map((event) => event.text).join("");
    assert.ok(text.includes(FIXTURE_MARKER));
    assert.ok(text.startsWith("[WebBridge test fixture - NOT a provider answer]"));
    const terminal = events.at(-1);
    assert.equal(terminal?.kind === "terminal" ? terminal.state : "missing", "uncertain");
    assert.match(await readFile(log, "utf8"), /fixture-turn:1:webbridge-chatgpt\/chatgpt-web:prompt-[a-f0-9]{16}:uncertain/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
