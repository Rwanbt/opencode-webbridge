/** The tool bridge: a web chat returns TEXT, so a well-formed block becomes a real
 *  `tool-call` — for ANY tool the model call offered, exactly like an API model.
 *  The rules under test are the ones that keep it honest: all-or-nothing parsing,
 *  only offered tools, and never an effect on a turn whose completion is unproven. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type {
  LanguageModelV3CallOptions, LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { TOOL_CALLS_RAW, createWebLanguageModel } from '../src/native/web-model.js';
import {
  MAX_OFFERED_TOOLS, MAX_TOOL_CALLS, TOOL_BRIDGE_OPT, TOOL_FENCE, firstFenceIndex, holdBack,
  offeredToolNames, parseToolCalls, toolBridgeEnabled, toolContract,
} from '../src/native/tool-bridge.js';
import { browserPrompt } from '../src/native/prompt.js';
import type { NativeTurnEvent, NativeTurnTransport } from '../src/native/turn-transport.js';

const block = (json: string) => TOOL_FENCE + '\n' + json + '\n```';
const OFFERED = ['bash', 'read', 'webbridge_readonly'] as const;
const ALLOWED = new Set<string>(OFFERED);
const READ = '{"tool":"read","args":{"path":"src/index.ts"}}';

test('the bridge is opt-in: only the exact value 1 enables it', () => {
  assert.equal(toolBridgeEnabled({ [TOOL_BRIDGE_OPT]: '1' }), true);
  for (const value of ['0', 'true', 'yes', '', undefined]) {
    assert.equal(toolBridgeEnabled({ [TOOL_BRIDGE_OPT]: value }), false, 'refused: ' + String(value));
  }
});

test('the contract is built from the tools the CALL offers, not a hard-coded list', () => {
  const contract = toolContract([
    { name: 'bash', description: 'Run a shell command' },
    { name: 'read' },
  ]);
  assert.ok(contract.includes(TOOL_FENCE));
  assert.ok(contract.includes('- bash: Run a shell command'));
  assert.ok(contract.includes('- read'));
  assert.ok(contract.includes(String(MAX_TOOL_CALLS)));
  // Nothing invented, and nothing offered is dropped silently.
  assert.ok(!contract.includes('webbridge_readonly'));
  // A tool name that cannot be a function name is not advertised.
  const filtered = toolContract([{ name: 'not a name' }, { name: 'bash' }]);
  assert.ok(!filtered.includes('not a name'));
  assert.ok(filtered.includes('- bash'));
  // Bounded: a huge tool list is truncated rather than pasted whole.
  const many = Array.from({ length: MAX_OFFERED_TOOLS + 5 }, (_, index) => ({ name: 'tool' + index }));
  const rendered = toolContract(many);
  assert.equal((rendered.match(/^- tool/gm) ?? []).length, MAX_OFFERED_TOOLS);
});

test('only a tool the call actually offered can be called', () => {
  const parsed = parseToolCalls(block(READ), ALLOWED);
  assert.equal(parsed.refused, false);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0]!.toolName, 'read');
  assert.deepEqual(JSON.parse(parsed.calls[0]!.input), { path: 'src/index.ts' });
  // An unoffered tool is refused, even if the model invents a plausible one.
  const unoffered = parseToolCalls(block('{"tool":"write","args":{}}'), ALLOWED);
  assert.deepEqual(unoffered.calls, []);
  assert.equal(unoffered.refused, true);
  assert.deepEqual(parseToolCalls(block(READ), new Set()).calls, [], 'no tools offered, no call');
});

test('anything malformed refuses EVERY call rather than executing a subset', () => {
  const cases: Array<[string, string]> = [
    ['broken json', block('{"tool":"read",')],
    ['unknown tool', block('{"tool":"nope","args":{}}')],
    ['args not an object', block('{"tool":"read","args":"src"}')],
    ['extra key', block('{"tool":"read","args":{},"extra":1}')],
    ['unterminated block', TOOL_FENCE + '\n' + READ],
  ];
  for (const [name, text] of cases) {
    const parsed = parseToolCalls(text, ALLOWED);
    assert.deepEqual(parsed.calls, [], name);
    assert.equal(parsed.refused, true, name);
  }
  const mixed = parseToolCalls(block(READ) + block('{"tool":"nope","args":{}}'), ALLOWED);
  assert.deepEqual(mixed.calls, []);
  assert.equal(mixed.refused, true);
});

test('more blocks than the contract allows is a refusal, not a partial run', () => {
  const many = Array.from({ length: MAX_TOOL_CALLS + 1 }, () => block(READ)).join('\n');
  assert.equal(parseToolCalls(many, ALLOWED).refused, true);
  const exact = parseToolCalls(Array.from({ length: MAX_TOOL_CALLS }, () => block(READ)).join('\n'), ALLOWED);
  assert.equal(exact.calls.length, MAX_TOOL_CALLS);
  assert.equal(exact.refused, false);
});

test('offered names come only from function tools with a usable name', () => {
  const names = offeredToolNames([
    { type: 'function', name: 'bash' },
    { type: 'function', name: 'read', description: 'x' },
    { type: 'provider', name: 'web_search' },
    { type: 'function', name: 'not a name' },
    { type: 'function' },
    null,
  ]);
  assert.deepEqual([...names].sort(), ['bash', 'read']);
  assert.deepEqual([...offeredToolNames(undefined)], []);
});

test('prose is never mistaken for a fence, and a partial fence is held back', () => {
  assert.equal(firstFenceIndex('a normal answer'), -1);
  assert.equal(firstFenceIndex('```js\ncode\n```'), -1, 'a different language fence is not ours');
  assert.equal(holdBack('answer ```webbridge'), '```webbridge'.length);
  assert.equal(holdBack('answer'), 0);
  assert.equal(holdBack('answer ' + TOOL_FENCE), 0, 'a complete fence is not held');
});

test('the browser prompt carries the contract, the question and any tool result', () => {
  const prompt = [
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'read src/index.ts' }] },
    {
      role: 'tool' as const,
      content: [{
        type: 'tool-result' as const, toolCallId: 'call-1', toolName: 'read',
        output: { type: 'text' as const, value: 'export default 1;' },
      }],
    },
  ];
  const contract = toolContract([{ name: 'read' }]);
  const bridged = browserPrompt(prompt, contract);
  assert.ok(bridged.startsWith(contract));
  assert.ok(bridged.includes('read src/index.ts'));
  assert.ok(bridged.includes('TOOL RESULT:\n[read]\nexport default 1;'));
  assert.equal(browserPrompt(prompt, null),
    'read src/index.ts\n\nTOOL RESULT:\n[read]\nexport default 1;');
});

const MODEL = {
  providerID: 'webbridge-chatgpt', modelID: 'chatgpt-web', providerName: 'ChatGPT',
  origin: 'https://chatgpt.com', fixture: false,
};
const TOOLS = [
  { type: 'function' as const, name: 'read', description: 'Read a file',
    inputSchema: { type: 'object' as const } },
];
const call = (text = 'read src/index.ts'): LanguageModelV3CallOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text' as const, text }] }],
  tools: TOOLS,
});
const transport = (events: NativeTurnEvent[]): NativeTurnTransport => ({
  async *stream() { for (const event of events) yield event; },
});
const complete = (text: string): NativeTurnEvent[] => [
  { kind: 'fragment', text } as NativeTurnEvent,
  { kind: 'terminal', state: 'complete', reason: 'dom-completion-proven' } as NativeTurnEvent,
];
const uncertain = (text: string): NativeTurnEvent[] => [
  { kind: 'fragment', text } as NativeTurnEvent,
  { kind: 'terminal', state: 'uncertain', reason: 'provider-finality-unverified' } as NativeTurnEvent,
];
async function parts(stream: ReadableStream<LanguageModelV3StreamPart>) {
  const reader = stream.getReader();
  const out: LanguageModelV3StreamPart[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) return out; if (value) out.push(value); }
}
const textOf = (collected: LanguageModelV3StreamPart[]) =>
  collected.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join('');

test('a proven turn with a valid block emits a real tool-call for an OFFERED tool', async () => {
  const model = createWebLanguageModel({
    ...MODEL, transport: transport(complete('je lis.\n' + block(READ))), toolBridge: true,
  });
  const collected = await parts((await model.doStream(call())).stream);
  const calls = collected.filter((p) => p.type === 'tool-call') as Array<{ toolName: string; input: string }>;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.toolName, 'read');
  assert.deepEqual(JSON.parse(calls[0]!.input), { path: 'src/index.ts' });
  assert.ok(!textOf(collected).includes(TOOL_FENCE), 'the block is never shown as text');
  assert.ok(textOf(collected).includes('je lis.'), 'prose before the block is kept');
  const finish = collected.at(-1) as { finishReason: { unified: string; raw: string } };
  assert.equal(finish.finishReason.unified, 'tool-calls');
  assert.equal(finish.finishReason.raw, TOOL_CALLS_RAW);
});

test('the contract sent to the browser names the tools of THIS call', async () => {
  let sent = '';
  const capturing: NativeTurnTransport = {
    async *stream(request) {
      sent = String((request as { prompt?: unknown }).prompt ?? '');
      for (const event of complete('ok')) yield event;
    },
  };
  const model = createWebLanguageModel({ ...MODEL, transport: capturing, toolBridge: true });
  await parts((await model.doStream(call())).stream);
  assert.ok(sent.includes('- read: Read a file'), 'the offered tool is described');
  assert.ok(sent.includes(TOOL_FENCE));
  const plain = createWebLanguageModel({ ...MODEL, transport: capturing, toolBridge: false });
  await parts((await plain.doStream(call())).stream);
  assert.ok(!sent.includes(TOOL_FENCE), 'without the bridge the prompt is unchanged');
  assert.ok(!sent.includes('- read'), 'and no tool list leaks into it');
});

test('an UNPROVEN turn never runs a tool: the text is delivered verbatim', async () => {
  const model = createWebLanguageModel({
    ...MODEL, transport: transport(uncertain(block(READ))), toolBridge: true,
  });
  const collected = await parts((await model.doStream(call())).stream);
  assert.equal(collected.filter((p) => p.type === 'tool-call').length, 0);
  assert.ok(textOf(collected).includes(TOOL_FENCE), 'the block stays as text');
  assert.equal((collected.at(-1) as { finishReason: { unified: string } }).finishReason.unified, 'error');
});

test('without the bridge the model stays exactly text-only', async () => {
  const model = createWebLanguageModel({
    ...MODEL, transport: transport(complete(block(READ))), toolBridge: false,
  });
  const collected = await parts((await model.doStream(call())).stream);
  assert.equal(collected.filter((p) => p.type === 'tool-call').length, 0);
  assert.ok(textOf(collected).includes(TOOL_FENCE));
});

test('doGenerate also turns a valid block into a tool-call on a proven turn', async () => {
  const model = createWebLanguageModel({
    ...MODEL, transport: transport(complete(block(READ))), toolBridge: true,
  });
  const generated = await model.doGenerate(call());
  const calls = generated.content.filter((part) => part.type === 'tool-call') as Array<{ toolName: string }>;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.toolName, 'read');
  assert.equal(generated.finishReason.unified, 'tool-calls');
});
