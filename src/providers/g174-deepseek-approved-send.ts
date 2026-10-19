/** G174: explicit, user-approved ONE-shot UI submission in an EXISTING DeepSeek tab.
 *
 *  Mirrors the reviewed G159 invariants exactly: the operator-declared loopback tab
 *  is the authorization, the durable one-shot is consumed BEFORE any UI effect, and
 *  a consumed attempt is never replayed. No OS/Desktop attestation; never auto-retry,
 *  authenticate, bypass CAPTCHA or inspect secrets.
 *
 *  Selectors observed on the real authenticated DeepSeek UI (2026-10-18):
 *  the composer is the single visible <textarea> (placeholder "Message à DeepSeek");
 *  the send control is a div[role="button"] carrying ds-button--primary, mounted
 *  only once the composer has content, so it is resolved AFTER the fill.
 */
import { createHash } from 'node:crypto';
import { MAX_PROMPT_CHARS } from '../core/prompt-bound.js';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent } from '../browser/explicit-cdp-read.js';

export interface G174SendAction {
  readonly sessionID: string;
  readonly turnID: string;
  readonly tabID: string;
  readonly generation: number;
  readonly url: string;
  readonly providerID: 'deepseek';
  readonly promptSHA256: string;
}
export interface G174SendConsent extends CdpConsent {
  /** Must be a separate human decision for THIS exact prompt, tab and turn. */
  readonly approveSend: (action: Readonly<G174SendAction>, promptToDisplay: string) => Promise<boolean>;
  /** Synchronous, host-owned revocation check; never trust page-authored data. */
  readonly isStillApproved: (action: Readonly<G174SendAction>) => boolean;
}
export interface G174SendRequest {
  readonly endpoint: string;
  readonly tabID: string;
  readonly sessionID: string;
  readonly turnID: string;
  readonly prompt: string;
  /** Pre-existing PRIVATE directory controlled by the operator/host. */
  readonly journalDir: string;
  readonly consent: G174SendConsent;
}

const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const deny = (reason: string): never => { throw new Error('G174 send refused: ' + reason); };
// Observed on the real UI: one visible textarea, one primary send control.
const COMPOSER = 'textarea:visible';
const SEND = 'div[role="button"][class*="ds-button--primary"]:visible';
const CHAT_ORIGIN = 'https://chat.deepseek.com';

/** Durable consume BEFORE any UI effect. No reset/rollback method exists. */
export async function g174ConsumeOnce(journalDir: string, turnID: string,
  action: G174SendAction): Promise<void> {
  if (!id(turnID) || typeof journalDir !== 'string') return deny('invalid one-shot journal key');
  const info = await lstat(journalDir);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
    return deny('one-shot journal directory must be a private real directory');
  const key = sha(JSON.stringify({ sessionID: action.sessionID, turnID, tabID: action.tabID,
    generation: action.generation, url: action.url, providerID: action.providerID,
    promptSHA256: action.promptSHA256 }));
  let file;
  try { file = await open(join(journalDir, key + '.send-once'), 'wx', 0o600); }
  catch { return deny('this exact send was already consumed'); }
  try {
    await file.writeFile(JSON.stringify({ version: 1, status: 'uncertain',
      actionHash: sha(JSON.stringify(action)) }) + '\n');
    await file.sync();
  } finally { await file.close(); }
}

const frameKey = async (session: CDPSession): Promise<string> => {
  const result = await session.send('Page.getFrameTree');
  return JSON.stringify(result?.frameTree?.frame ?? null);
};

export async function g174SendDeepseekOnce(request: G174SendRequest): Promise<{
  readonly status: 'uncertain'; readonly turnID: string;
}> {
  const { endpoint, tabID, sessionID, turnID, prompt, journalDir, consent } = request;
  if (!id(tabID) || !id(sessionID) || !id(turnID) ||
      typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt) ||
      typeof consent?.approveSend !== 'function' ||
      typeof consent?.isStillApproved !== 'function')
    return deny('invalid request or missing explicit send authorization');
  const discovery = new ExplicitCdpReadBridge(endpoint, consent);
  let browser: Browser | undefined;
  let consumed = false;
  /** Only for the best-effort cleanup of the draft WE typed (never a retry). */
  let selectedPage: Page | undefined;
  try {
    await discovery.open();
    const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
    if (!tab || tab.providerID !== 'deepseek' || new URL(tab.url).origin !== CHAT_ORIGIN)
      return deny('selected DeepSeek tab missing');
    const action: G174SendAction = Object.freeze({
      sessionID, turnID, tabID, generation: tab.generation, url: tab.url,
      providerID: 'deepseek', promptSHA256: sha(prompt),
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    let page: Page | undefined;
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      const proof = await context.newCDPSession(candidate);
      try {
        if ((await proof.send('Target.getTargetInfo')).targetInfo?.targetId === tabID) {
          if (page) return deny('ambiguous duplicate CDP tab');
          page = candidate;
        }
      } finally { await proof.detach(); }
    }
    if (!page || page.url() !== tab.url) return deny('selected page/URL mismatch');
    selectedPage = page;
    const selected = page;
    const session = await selected.context().newCDPSession(selected);
    try {
      const firstFrame = await frameKey(session);
      const recheck = async () => {
        await discovery.verify(tab);
        if (selected.url() !== tab.url || await frameKey(session) !== firstFrame)
          return deny('navigation or document generation replaced');
      };
      const composer = selected.locator(COMPOSER);
      await recheck();
      // The send control is mounted only once the composer has content, so the
      // composer is the pre-fill requirement; the control is resolved after.
      if (await composer.count() !== 1 || !await composer.isVisible())
        return deny('missing or ambiguous accessible composer');
      const blank = await composer.evaluate((element) => {
        const value = element instanceof HTMLTextAreaElement ? element.value : element.textContent;
        return !value?.trim();
      });
      if (!blank) return deny('nonempty user draft cannot be replaced');
      await recheck();
      if (await consent.approveSend(action, prompt) !== true) return deny('operator declined this send');
      await recheck();
      if (!await composer.evaluate((element) => {
        const value = element instanceof HTMLTextAreaElement ? element.value : element.textContent;
        return !value?.trim();
      })) return deny('user draft changed during approval');
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      await g174ConsumeOnce(journalDir, turnID, action);
      consumed = true; // After this point ANY failure is uncertain and cannot be retried.
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      await composer.fill(prompt, { timeout: 2000 });
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      const button = selected.locator(SEND);
      if (await composer.count() !== 1 || await button.count() !== 1 ||
          !await button.isVisible())
        return deny('send control changed after filling');
      // At most ONE user-visible click; never retry on timeout, navigation or lost ACK.
      // Observed on the real authenticated UI (2026-10-19): the DeepSeek send
      // control animates, so Playwright's actionability/stability check times out
      // at 2 s and the click never lands (the turn then settles `send-uncertain`
      // with 0 delivered fragments). Qwen and Mistral carry the same documented
      // treatment; the send control itself is unambiguous (exactly one visible
      // `ds-button--primary` node).
      await button.click({ timeout: 5000, noWaitAfter: true, force: true });
      return Object.freeze({ status: 'uncertain' as const, turnID });
    } finally { await session.detach().catch(() => {}); }
  } catch (error) {
    if (consumed) {
      // A consumed attempt is never replayed. Best effort only: remove the prompt
      // WE typed when no click landed, so a failed turn never leaves our text in
      // the user's composer (otherwise every later turn is refused with
      // "nonempty user draft cannot be replaced"). Cleanup of our own draft.
      try { if (selectedPage) await selectedPage.locator(COMPOSER).fill('', { timeout: 1000 }); } catch { /* ignore */ }
      throw new Error('G174_SEND_UNCERTAIN: consumed before UI effect; do not replay');
    }
    throw error;
  } finally {
    discovery.close();
    await browser?.close(); // detach CDP client, DO NOT close user's actual Chrome
  }
}
