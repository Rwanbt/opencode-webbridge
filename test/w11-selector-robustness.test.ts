/** Selector robustness + provider-final completion evidence.
 *
 *  These cases run the REAL in-page readers in Chromium against DOM fixtures
 *  served locally (no network, no account). They pin the live layouts observed
 *  on 2026-10-18 and the failure modes that motivated the hardening: a trailing
 *  empty turn (Qwen), a dead primary selector, and — critically — a streaming
 *  turn that must NEVER be reported as complete. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { chromium, type Browser, type Page } from 'playwright';
import { g160ReadOtherDOM } from '../src/providers/g160-other-provider-dom.js';
import { g156ChatgptReadDOM } from '../src/providers/g156-chatgpt-dom.js';

const CASES = [
  {
    name: 'deepseek: assistant body with a stable message id (no finality bar -> never complete)',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div data-message-id="ds-live-1"><div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>',
    expect: { messageKey: 'ds-live-1', text: 'DS answer', finalized: false },
  },
  {
    name: 'deepseek: its ICON-ONLY action bar proves completion (no labels exist to match)',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div class="turn"><div data-message-id="ds-icon-1">'
      + '<div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>'
      + '<div class="actions">'
      + '<button><svg><path d="M6.14929 4.02032C7.111"></path></svg></button>'
      + '<button><svg><path d="M7.92136 0.349152C10.3"></path></svg></button>'
      + '<button><svg><path d="M8.27868 0.811572C8.81"></path></svg></button>'
      + '<button><svg><path d="M7.72451 15.1086C7.189"></path></svg></button>'
      + '</div></div>',
    expect: { messageKey: 'ds-icon-1', text: 'DS answer', finalized: true },
  },
  {
    name: 'deepseek: three icon controls are below the complete-bar threshold',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div class="turn"><div data-message-id="ds-icon-2">'
      + '<div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>'
      + '<div class="actions">'
      + '<button><svg><path d="M6.14929 4.02032C7.111"></path></svg></button>'
      + '<button><svg><path d="M7.92136 0.349152C10.3"></path></svg></button>'
      + '<button><svg><path d="M8.27868 0.811572C8.81"></path></svg></button>'
      + '</div></div>',
    expect: { messageKey: 'ds-icon-2', text: 'DS answer', finalized: false },
  },
  {
    name: 'deepseek: unrelated icon controls are never mistaken for the action bar',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div class="turn"><div data-message-id="ds-icon-3">'
      + '<div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>'
      + '<div class="actions">'
      + '<button><svg><path d="M1.0 1.0C2.0"></path></svg></button>'
      + '<button><svg><path d="M2.0 2.0C3.0"></path></svg></button>'
      + '<button><svg><path d="M3.0 3.0C4.0"></path></svg></button>'
      + '<button><svg><path d="M4.0 4.0C5.0"></path></svg></button>'
      + '</div></div>',
    expect: { messageKey: 'ds-icon-3', text: 'DS answer', finalized: false },
  },
  {
    name: 'deepseek: an active stop control vetoes completion even with the icon bar',
    provider: 'deepseek' as const,
    url: 'https://chat.deepseek.com/a/chat/s/abcdefgh-1234',
    html: '<div class="turn"><div data-message-id="ds-icon-4">'
      + '<div class="ds-markdown ds-assistant-message-main-content">DS answer</div></div>'
      + '<div class="actions">'
      + '<button><svg><path d="M6.14929 4.02032C7.111"></path></svg></button>'
      + '<button><svg><path d="M7.92136 0.349152C10.3"></path></svg></button>'
      + '<button><svg><path d="M8.27868 0.811572C8.81"></path></svg></button>'
      + '<button><svg><path d="M7.72451 15.1086C7.189"></path></svg></button>'
      + '</div></div>'
      + '<button aria-label="Arrêter"></button>',
    expect: { messageKey: 'ds-icon-4', text: 'DS answer', finalized: false },
  },
  {
    name: 'gemini: model-response pair with its finalized action bar',
    provider: 'gemini' as const,
    url: 'https://gemini.google.com/app/abcdef',
    html: '<model-response data-message-id="ge-live-1"><model-response-content>GE answer</model-response-content>'
      + '<button aria-label="Copier"></button><button aria-label="Bonne réponse"></button></model-response>',
    expect: { messageKey: 'ge-live-1', text: 'GE answer', finalized: true },
  },
  {
    name: 'gemini: a single stray control is not enough to claim completion',
    provider: 'gemini' as const,
    url: 'https://gemini.google.com/app/abcdef',
    html: '<model-response data-message-id="ge-live-2"><model-response-content>GE answer</model-response-content>'
      + '<button aria-label="Copier"></button></model-response>',
    expect: { messageKey: 'ge-live-2', text: 'GE answer', finalized: false },
  },
  {
    name: 'mistral: assistant role container with its finalized action bar',
    provider: 'mistral' as const,
    url: 'https://chat.mistral.ai/chat/abcdef',
    html: '<div data-message-id="mi-live-1" data-message-author-role="assistant"><div class="markdown">MI answer</div>'
      + '<button aria-label="Copy to clipboard"></button><button aria-label="Rewrite"></button></div>',
    expect: { messageKey: 'mi-live-1', text: 'MI answer', finalized: true },
  },
  {
    name: 'qwen: a trailing empty turn must not hide the real answer',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div></div>'
      + '<div id="chat-response-message-b"></div>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer', finalized: false },
  },
  {
    name: 'qwen: a container with two bodies is skipped, never guessed',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div></div>'
      + '<div id="chat-response-message-b"><div class="qwen-markdown">one</div>'
      + '<div class="qwen-markdown">two</div></div>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer', finalized: false },
  },
  {
    name: 'qwen: the finalized action bar proves completion',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div>'
      + '<button aria-label="Copier"></button><button aria-label="Régénérer"></button></div>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer', finalized: true },
  },
  {
    name: 'qwen: an ACTIVE stop control vetoes completion even with the action bar',
    provider: 'qwen' as const,
    url: 'https://chat.qwen.ai/c/abcdef',
    html: '<div id="chat-response-message-a"><div class="qwen-markdown">QW answer</div>'
      + '<button aria-label="Copier"></button><button aria-label="Régénérer"></button></div>'
      + '<button aria-label="Arrêter"></button>',
    expect: { messageKey: 'chat-response-message-a', text: 'QW answer', finalized: false },
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
  // The charset is mandatory: without it Chromium decodes the body as
  // windows-1252 and accented provider labels ("Bonne réponse") arrive as
  // mojibake, which would silently defeat the finality detection under test.
  await page.route(origin + '/**', (route) => route.fulfill({
    status: 200, contentType: 'text/html; charset=utf-8', body: html,
  }));
}

const BROWSER = process.env.WEBBRIDGE_G160_BROWSER === '1';

test('G160 readers: live layouts, trailing empty turn, finality bar and fail-closed unknown UI', {
  skip: !BROWSER,
}, async () => {
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

test('G156 ChatGPT reader: work/legacy layouts, ambiguity refusal and the user-turn trap', {
  skip: !BROWSER,
}, async () => {
  const browser: Browser = await chromium.launch({ headless: true });
  const cases = [
    {
      name: 'work layout reads the last assistant turn (no finality bar yet)',
      html: '<div data-content-search-unit-key="u1:assistant">'
        + '<div data-markdown-text-style="assistant-message">first</div></div>'
        + '<div data-content-search-unit-key="u2:assistant">'
        + '<div data-markdown-text-style="assistant-message">second</div></div>',
      expect: { messageKey: 'u2:assistant', layout: 'work', text: 'second', finalized: false },
    },
    {
      name: 'legacy article layout still reads',
      html: '<article data-turn="assistant" data-turn-id="turn-7">'
        + '<div class="markdown">legacy answer</div></article>',
      expect: { messageKey: 'turn-7', layout: 'legacy', text: 'legacy answer', finalized: false },
    },
    {
      name: 'the assistant finality bar (ancestor level) proves completion',
      html: '<div data-content-search-unit-key="u5:assistant">'
        + '<div data-markdown-text-style="assistant-message">done</div>'
        + '<button aria-label="Copier"></button>'
        + '<button aria-label="Régénérer la réponse"></button></div>',
      expect: { messageKey: 'u5:assistant', layout: 'work', text: 'done', finalized: true },
    },
    {
      name: 'the USER turn controls must never be borrowed as completion evidence',
      html: '<div class="turn"><div class="user">'
        + '<button aria-label="Copier le message"></button>'
        + '<button aria-label="Modifier le message"></button>'
        + '<button aria-label="Partager le prompt"></button></div>'
        + '<div data-content-search-unit-key="u6:assistant">'
        + '<div data-markdown-text-style="assistant-message">streaming</div></div></div>',
      expect: { messageKey: 'u6:assistant', layout: 'work', text: 'streaming', finalized: false },
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
