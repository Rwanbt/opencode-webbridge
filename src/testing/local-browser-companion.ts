import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';

/** A fresh headless browser context, not a user's existing signed-in browser. */
export async function openLocalBrowserCompanion(): Promise<{
  readonly page: Page;
  close(): Promise<void>;
}> {
  const browser: Browser = await chromium.launch({ headless: true });
  let context: BrowserContext;
  try {
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    return { page, close: async () => { await context.close(); await browser.close(); } };
  } catch (error) { await browser.close(); throw error; }
}

/** Browser-side fixture driver: refuses all URLs except one explicit loopback page. */
export async function submitLocalPageTurn(page: Page, pageURL: string, prompt: string,
  onProgress?: (chunk: string, seq: number) => Promise<void>): Promise<string> {
  const url = new URL(pageURL);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('only explicit local test page URLs are allowed');
  }
  if (typeof prompt !== 'string' || !prompt || prompt.length > 16_000) {
    throw new Error('local browser prompt out of bounds');
  }
  await page.route('**/*', (route) => route.request().url() === pageURL ? route.continue() : route.abort());
  await page.goto(pageURL, { waitUntil: 'domcontentloaded', timeout: 6_000 });
  if (page.url() !== pageURL) throw new Error('unexpected browser navigation');
  await page.getByRole('textbox', { name: 'Prompt' }).fill(prompt);
  await page.getByRole('button', { name: 'Send' }).click();
  const turn = await page.locator('[role="status"]').getAttribute('data-turn');
  if (!turn) throw new Error('local browser turn uncertain: missing DOM identity');
  let cursor = 0;
  let output = '';
  while (true) {
    await page.waitForFunction(({ seq, turnID }) => {
      const state = document.getElementById('response');
      if (state?.dataset.turn !== turnID) return true;
      return Number(state?.dataset.seq ?? 0) > seq ||
        state?.dataset.state === 'finished' || state?.dataset.state === 'stopped';
    }, { seq: cursor, turnID: turn }, { timeout: 6_000 });
    const status = page.locator('[role="status"]');
    if (page.url() !== pageURL || await status.getAttribute('data-turn') !== turn)
      throw new Error('local browser turn uncertain: tab or document changed');
    const count = Number(await status.getAttribute('data-seq'));
    if (!Number.isSafeInteger(count) || count < cursor || count > 32) throw new Error('invalid fixture cursor');
    while (cursor < count) {
      const chunk = await status.locator(`span[data-seq="${cursor + 1}"]`).textContent();
      if (!chunk || chunk.length > 4096 || output.length + chunk.length > 16_000)
        throw new Error('local browser progress out of bounds');
      output += chunk;
      cursor++;
      await onProgress?.(chunk, cursor);
    }
    const state = await status.getAttribute('data-state');
    if (state === 'stopped') throw new Error('local browser turn uncertain: stopped after submit; reconcile before retry');
    if (state === 'finished') break;
  }
  if (!output || !output.startsWith('WEBBRIDGE_LOCAL_PAGE_OK:') || output.length > 16_100) {
    throw new Error('invalid local page response');
  }
  return output;
}
