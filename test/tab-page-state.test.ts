import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tabPageState, conversationRequired, pageHasTurns } from '../src/browser/tab-page-state.js';

test('the five measured tabs classify exactly as they failed or answered', () => {
  // Answered on 2026-10-19 -> conversation URLs.
  assert.equal(tabPageState('https://chatgpt.com/c/6ad5eff8-5514-83eb-a6c7-69357c7da295').kind, 'conversation');
  assert.equal(tabPageState('https://chat.mistral.ai/work/e3af6371-931a-4789-a13f-301353186996').kind, 'conversation');
  // Failed on 2026-10-19 -> home / new-chat pages.
  assert.equal(tabPageState('https://chat.deepseek.com/').kind, 'home');
  assert.equal(tabPageState('https://gemini.google.com/app?pli=1').kind, 'home');
  assert.equal(tabPageState('https://chat.qwen.ai/').kind, 'home');
});

test('a home page is named in the refusal, with the action to take', () => {
  assert.match(conversationRequired('gemini', 'https://gemini.google.com/app?pli=1') ?? '',
    /^gemini: .*home\/new-chat page \(\/app\).*open a conversation in that tab, then declare it again/);
  assert.equal(conversationRequired('gemini', 'https://gemini.google.com/app/1a2b3c'), null);
});

test('the rule stays conservative: deeper conversation paths are never refused', () => {
  for (const url of [
    'https://chat.deepseek.com/a/chat/s/2f1c',
    'https://gemini.google.com/app/1a2b3c',
    'https://chat.qwen.ai/c/9d8e7f',
    'https://chatgpt.com/g/g-p-abc/c/6ad5eff8',
  ]) {
    assert.equal(tabPageState(url).kind, 'conversation', url);
  }
});

test('an unparsable URL is refused rather than assumed good', () => {
  assert.equal(tabPageState('not a url').kind, 'home');
  assert.match(tabPageState('not a url').detail, /cannot be parsed/);
});

test('Qwen rendered turns are evidence, even though its URL stays "/"', async () => {
  // Measured on the live tab: five rendered answers while location.pathname stayed
  // '/', and no model-response / article node on the page. Only the turn ids exist.
  let queried = '';
  const turns = { evaluateSource: async <T,>(source: string): Promise<T> => {
    queried = source;
    return 5 as unknown as T;
  } };
  assert.equal(await pageHasTurns(turns), true);
  assert.match(queried, /chat-response-message/, 'the probe must name Qwen turn ids');
  const empty = { evaluateSource: async <T,>(): Promise<T> => 0 as unknown as T };
  assert.equal(await pageHasTurns(empty), false);
  const detached = { evaluateSource: async <T,>(): Promise<T> => { throw new Error('detached'); } };
  assert.equal(await pageHasTurns(detached), false);
});
