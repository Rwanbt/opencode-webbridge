import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { tabPageState, conversationRequired } from '../src/browser/tab-page-state.js';

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
