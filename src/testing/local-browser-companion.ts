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
export async function submitLocalPageTurn(page: Page, pageURL: string, prompt: string): Promise<string> {
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
  await page.locator('[role="status"][data-state="finished"]').waitFor({ timeout: 6_000 });
  const output = await page.locator('[role="status"]').textContent();
  if (!output || !output.startsWith('WEBBRIDGE_LOCAL_PAGE_OK:') || output.length > 16_100) {
    throw new Error('invalid local page response');
  }
  return output;
}
