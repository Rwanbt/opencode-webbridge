/** The read-only tool bridge: a web chat returns TEXT, so a well-formed block is
 *  turned back into a real `tool-call`. The rules under test are the ones that
 *  keep it honest — all-or-nothing parsing, read-only surface, and never running
 *  an effect on a turn whose completion is not proven. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type {
  LanguageModelV3CallOptions, LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import {
  TOOL_CALLS_RAW, createWebLanguageModel,
} from '../src/native/web-model.js';
import {
  BRIDGE_TOOL_NAME, MAX_TOOL_CALLS, TOOL_BRIDGE_OPT, TOOL_FENCE, firstFenceIndex, holdBack,
  parseToolCalls, toolBridgeEnabled, toolContract,
} from '../src/native/tool-bridge.js';
import { browserPrompt } from '../src/native/prompt.js';
import type { NativeTurnEvent, NativeTurnTransport } from '../src/native/turn-transport.js';

const block = (json: string) => TOOL_FENCE + '\n' + json + '\n```';
const READ = '{"tool":"webbridge_readonly","args":{"action":"file.read","path":"src/index.ts"}}';

test('the bridge is opt-in: only the exact value 1 enables it', () => {
  assert.equal(toolBridgeEnabled({ [TOOL_BRIDGE_OPT]: '1' }), true);
  for (const value of ['0', 'true', 'yes', '', undefined]) {
    assert.equal(toolBridgeEnabled({ [TOOL_BRIDGE_OPT]: value }), false, 'refused: ' + String(value));
  }
  // The contract names the fence and every allowed action, and nothing else.
  const contract = toolContract();
  assert.ok(contract.includes(TOOL_FENCE));
  for (const action of ['file.read', 'git.status', 'git.diff', 'git.log'])
    assert.ok(contract.includes(action), action);
  assert.ok(contract.includes(BRIDGE_TOOL_NAME));
  assert.ok(contract.includes(String(MAX_TOOL_CALLS)));
});

test('a well-formed block becomes a read-only call with stringified input', () => {
  const parsed = parseToolCalls(block(READ));
  assert.equal(parsed.refused, false);
  assert.equal(parsed.calls.length, 1);
  assert.equal(parsed.calls[0]!.toolName, BRIDGE_TOOL_NAME);
  assert.deepEqual(JSON.parse(parsed.calls[0]!.input), { action: 'file.read', path: 'src/index.ts' });
});

test('anything malformed refuses EVERY call rather than executing a subset', () => {
  const cases: Array<[string, string]> = [
    ['broken json', block('{"tool":"webbridge_readonly",')],
    ['unknown tool', block('{"tool":"shell","args":{"action":"file.read","path":"a"}}')],
    ['unknown action', block('{"tool":"webbridge_readonly","args":{"action":"file.write","path":"a"}}')],
    ['file.read without path', block('{"tool":"webbridge_readonly","args":{"action":"file.read"}}')],
    ['extra key', block('{"tool":"webbridge_readonly","args":{"action":"git.status"},"extra":1}')],
    ['args not an object', block('{"tool":"webbridge_readonly","args":"file.read"}')],
    ['unterminated block', TOOL_FENCE + '\n' + READ],
  ];
  for (const [name, text] of cases) {
    const parsed = parseToolCalls(text);
    assert.deepEqual(parsed.calls, [], name);
    assert.equal(parsed.refused, true, name);
  }
  // One good block among a malformed one still refuses everything.
  const mixed = parseToolCalls(block(READ) + block('{"tool":"shell","args":{}}'));
  assert.deepEqual(mixed.calls, []);
  assert.equal(mixed.refused, true);
});

test('more blocks than the contract allows is a refusal, not a partial run', () => {
  const many = Array.from({ length: MAX_TOOL_CALLS + 1 }, () => block(READ)).join('\n');
  const parsed = parseToolCalls(many);
  assert.deepEqual(parsed.calls, []);
  assert.equal(parsed.refused, true);
  const exact = parseToolCalls(Array.from({ length: MAX_TOOL_CALLS }, () => block(READ)).join('\n'));
  assert.equal(exact.calls.length, MAX_TOOL_CALLS);
  assert.equal(exact.refused, false);
});

test('prose is never mistaken for a fence, and a partial fence is held back', () => {
  assert.equal(firstFenceIndex('a normal answer'), -1);
  assert.equal(firstFenceIndex('```js\ncode\n```'), -1, 'a different language fence is not ours');
  // A trailing partial fence must not be flushed as text before it completes.
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
        type: 'tool-result' as const, toolCallId: 'call-1', toolName: 'webbridge_readonly',
        output: { type: 'text' as const, value: 'export default 1;' },
      }],
    },
  ];
  const bridged = browserPrompt(prompt, toolContract());
  assert.ok(bridged.startsWith(toolContract()));
  assert.ok(bridged.includes('read src/index.ts'));
  assert.ok(bridged.includes('TOOL RESULT:\n[webbridge_readonly]\nexport default 1;'));
  // Without the bridge the prompt is exactly the previous behaviour.
  assert.equal(browserPrompt(prompt, null),
    'read src/index.ts\n\nTOOL RESULT:\n[webbridge_readonly]\nexport default 1;');
  assert.equal(browserPrompt([{ role: 'user', content: [{ type: 'text' as const, text: 'hi' }] }], null), 'hi');
});

const MODEL = {
  providerID: 'webbridge-chatgpt', modelID: 'chatgpt-web', providerName: 'ChatGPT',
  origin: 'https://chatgpt.com', fixture: false,
};
const call = (text = 'read src/index.ts'): LanguageModelV3CallOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text' as const, text }] }],
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

test('a proven turn with a valid block emits a real tool-call and no raw block text', async () => {
  const model = createWebLanguageModel({ ...MODEL, transport: transport(complete('je lis.\n' + block(READ))), toolBridge: true });
  const collected = await parts((await model.doStream(call())).stream);
  const calls = collected.filter((p) => p.type === 'tool-call') as Array<{ toolName: string; input: string }>;
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.toolName, BRIDGE_TOOL_NAME);
  assert.deepEqual(JSON.parse(calls[0]!.input), { action: 'file.read', path: 'src/index.ts' });
  assert.ok(!textOf(collected).includes(TOOL_FENCE), 'the block is never shown as text');
  assert.ok(textOf(collected).includes('je lis.'), 'prose before the block is kept');
  const finish = collected.at(-1) as { type: string; finishReason: { unified: string; raw: string } };
  assert.equal(finish.finishReason.unified, 'tool-calls');
  assert.equal(finish.finishReason.raw, TOOL_CALLS_RAW);
});

test('an UNPROVEN turn never runs a tool: the text is delivered verbatim', async () => {
  const model = createWebLanguageModel({ ...MODEL, transport: transport(uncertain(block(READ))), toolBridge: true });
  const collected = await parts((await model.doStream(call())).stream);
  assert.equal(collected.filter((p) => p.type === 'tool-call').length, 0);
  assert.ok(textOf(collected).includes(TOOL_FENCE), 'the block stays as text');
  assert.equal((collected.at(-1) as { finishReason: { unified: string } }).finishReason.unified, 'error');
});

test('without the bridge the model stays exactly text-only', async () => {
  const model = createWebLanguageModel({ ...MODEL, transport: transport(complete(block(READ))), toolBridge: false });
  const collected = await parts((await model.doStream(call())).stream);
  assert.equal(collected.filter((p) => p.type === 'tool-call').length, 0);
  assert.ok(textOf(collected).includes(TOOL_FENCE), 'text is forwarded as-is');
  const generated = await createWebLanguageModel({ ...MODEL, transport: transport(complete('ok')), toolBridge: false })
    .doGenerate(call());
  assert.equal(generated.finishReason.unified, 'stop');
});

test('doGenerate also turns a valid block into a tool-call on a proven turn', async () => {
  const model = createWebLanguageModel({ ...MODEL, transport: transport(complete(block(READ))), toolBridge: true });
  const generated = await model.doGenerate(call());
  const calls = generated.content.filter((part) => part.type === 'tool-call') as Array<{ toolName: string }>;
  assert.equal(calls.length, 1);
  assert.equal(generated.finishReason.unified, 'tool-calls');
});
