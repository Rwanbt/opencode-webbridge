/** Selector robustness: the in-page readers are exercised against real DOM
 *  fixtures served locally (no network, no account). These cases pin the live
 *  layouts observed on 2026-10-18 and the two failure modes that motivated the
 *  hardening: a trailing empty turn (Qwen) and a dead primary selector. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { g160ReadOtherDOM } from '../src/providers/g160-other-provider-dom.js';
import { g156ChatgptReadDOM } from '../src/providers/g156-chatgpt-dom.js';

const CASES = [
  {
    name: 'deepseek: assistant body with a stable message id',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div data-message-id="ds-live-1"><div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>',
    expect: { messageKey: 'ds-live-1', text: 'DS answer' },
  },
  {
    name: 'gemini: model-response/model-response-content pair',
    provider: 'gemini' as const,
    url: 'https://gemini.google.com/app/abcdef',
    html: '<model-response data-message-id="ge-live-1"><model-response-content>GE answer</model-response-content></model-response>',
    expect: { messageKey: 'ge-live-1', text: 'GE answer' },
  },
  {
    name: 'mistral: assistant role container with one markdown body',
    provider: 'mistral' as const,
    url: 'https://chat.mistral.ai/chat/abcdef',
    html: '<div data-message-id="mi-live-1" data-message-author-role="assistant"><div class="markdown">MI answer</div></div>',
    expect: { messageKey: 'mi-live-1', text: 'MI answer' },
  },
  {
    name: 'qwen: a trailing empty turn must not hide the real answer',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div></div>'
      + '<div id="chat-response-message-b"></div>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer' },
  },
  {
    name: 'qwen: a container with two bodies is skipped, never guessed',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div></div>'
      + '<div id="chat-response-message-b"><div class="qwen-markdown">one</div>'
      + '<div class="qwen-markdown">two</div></div>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer' },
  },
  {
    name: 'qwen: an unrecognized layout reads nothing (fail closed)',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div class="some-future-class">QW answer</div>',
    expect: null,
  },
] as const;

async function serve(page: Page, origin: string, html: string): Promise<void> {
  await page.route(origin + '/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: html,
  }));
}

test('G160 readers: live layouts, trailing empty turn and fail-closed unknown UI', async () => {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    for (const item of CASES) {
      const page = await browser.newPage();
      try {
        await serve(page, new URL(item.url).origin, item.html);
        await page.goto(item.url, { waitUntil: 'domcontentloaded' });
        const result = await page.evaluate(g160ReadOtherDOM, item.provider);
        assert.deepEqual(result, item.expect, item.name);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});

test('G156 ChatGPT reader: work layout, legacy fallback and ambiguity refusal', async () => {
  const browser: Browser = await chromium.launch({ headless: true });
  const cases = [
    {
      name: 'work layout wins and reads the last assistant turn',
      html: '<div data-content-search-unit-key="u1:assistant">'
        + '<div data-markdown-text-style="assistant-message">first</div></div>'
        + '<div data-content-search-unit-key="u2:assistant">'
        + '<div data-markdown-text-style="assistant-message">second</div></div>',
      expect: { messageKey: 'u2:assistant', layout: 'work', text: 'second' },
    },
    {
      name: 'legacy article layout still reads',
      html: '<article data-turn="assistant" data-turn-id="turn-7">'
        + '<div class="markdown">legacy answer</div></article>',
      expect: { messageKey: 'turn-7', layout: 'legacy', text: 'legacy answer' },
    },
    {
      name: 'two answer bodies in one turn is ambiguous and refused',
      html: '<div data-content-search-unit-key="u9:assistant">'
        + '<div data-markdown-text-style="assistant-message">a</div>'
        + '<div data-markdown-text-style="assistant-message">b</div></div>',
      expect: null,
    },
  ] as const;
  try {
    for (const item of cases) {
      const page = await browser.newPage();
      try {
        await serve(page, 'https://chatgpt.com', item.html);
        await page.goto('https://chatgpt.com/c/abcdef', { waitUntil: 'domcontentloaded' });
        assert.deepEqual(await page.evaluate(g156ChatgptReadDOM), item.expect, item.name);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
