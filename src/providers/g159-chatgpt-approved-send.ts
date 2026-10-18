/** G159: explicit, user-approved ONE-shot UI submission in an EXISTING Chrome tab.
 * No OS/Desktop attestation; never auto-retry, authenticate, bypass CAPTCHA or inspect secrets. */
import { createHash } from 'node:crypto';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type Page, type CDPSession } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from '../browser/explicit-cdp-read.js';

export interface G159SendAction {
  readonly sessionID: string;
  readonly turnID: string;
  readonly tabID: string;
  readonly generation: number;
  readonly url: string;
  readonly providerID: 'chatgpt';
  readonly promptSHA256: string;
}
export interface G159SendConsent extends CdpConsent {
  /** Must be a separate human decision for THIS exact prompt, tab and turn. */
  /** Display prompt text to the operator; it is never persisted by the journal. */
  readonly approveSend: (action: Readonly<G159SendAction>, promptToDisplay: string) => Promise<boolean>;
  /** Synchronous, host-owned revocation check; never trust page-authored data. */
  readonly isStillApproved: (action: Readonly<G159SendAction>) => boolean;
}
export interface G159SendRequest {
  readonly endpoint: string;
  readonly tabID: string;
  readonly sessionID: string;
  readonly turnID: string;
  readonly prompt: string;
  /** Pre-existing PRIVATE directory controlled by the operator/host. */
  readonly journalDir: string;
  readonly consent: G159SendConsent;
}
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const deny = (reason: string): never => { throw new Error('G159 send refused: ' + reason); };
const COMPOSER = '#prompt-textarea[contenteditable="true"],textarea#prompt-textarea,' +
  '[role="textbox"][contenteditable="true"][data-testid="composer-input"]';
const SEND = 'button[data-testid="send-button"],button[aria-label="Send message"],' +
  'button[aria-label="Send prompt"],button[aria-label="Envoyer le message"]';

/** Durable consume BEFORE any UI effect. No reset/rollback method exists. */
export async function g159ConsumeOnce(journalDir: string, turnID: string, action: G159SendAction): Promise<void> {
  if (!id(turnID) || typeof journalDir !== 'string') return deny('invalid one-shot journal key');
  const info = await lstat(journalDir);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.platform !== 'win32' && (info.mode & 0o077) !== 0) ||
      (process.getuid && info.uid !== process.getuid())) return deny('private journal directory required');
  const key = sha(turnID); // one turn = one attempt EVEN if caller changes tab/prompt
  let file;
  try { file = await open(join(journalDir, key + '.g159-once'), 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return deny('turn already consumed; reconcile manually');
    throw error;
  }
  try {
    await file.writeFile(JSON.stringify({
      version: 1, status: 'uncertain', actionHash: sha(JSON.stringify(action)),
    }) + '\n');
    await file.sync();
  } finally { await file.close(); }
  if (process.platform !== 'win32') {
    const dir = await open(journalDir, 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
}

async function cdpFrame(session: CDPSession): Promise<string> {
  const result = await session.send('Page.getFrameTree');
  const frame = result.frameTree?.frame;
  if (!frame?.loaderId || !frame.id || !frame.url) return deny('CDP document identity unavailable');
  return frame.id + '\0' + frame.loaderId + '\0' + frame.url;
}

/** Returns UNCERTAIN, never provider-accepted. A click may have landed before transport loss. */
export async function g159SendChatgptOnce(request: G159SendRequest): Promise<{
  readonly status: 'uncertain'; readonly turnID: string;
}> {
  const { endpoint, tabID, sessionID, turnID, prompt, journalDir, consent } = request;
  if (!id(tabID) || !id(sessionID) || !id(turnID) ||
      typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt) ||
      typeof consent?.approveSend !== 'function' ||
      typeof consent?.isStillApproved !== 'function') return deny('invalid request or missing explicit send authorization');
  const discovery = new ExplicitCdpReadBridge(endpoint, consent);
  let browser: Browser | undefined;
  let consumed = false;
  try {
    await discovery.open();
    const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
    if (!tab || tab.providerID !== 'chatgpt' || new URL(tab.url).origin !== 'https://chatgpt.com')
      return deny('selected ChatGPT tab missing');
    const action: G159SendAction = Object.freeze({
      sessionID, turnID, tabID, generation: tab.generation, url: tab.url,
      providerID: 'chatgpt', promptSHA256: sha(prompt),
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
    const selected = page;
    const session = await selected.context().newCDPSession(selected);
    try {
      const firstFrame = await cdpFrame(session);
      const recheck = async () => {
        await discovery.verify(tab);
        if (selected.url() !== tab.url || await cdpFrame(session) !== firstFrame)
          return deny('navigation or document generation replaced');
      };
      const composer = selected.locator(COMPOSER), button = selected.locator(SEND);
      await recheck();
      if (await composer.count() !== 1 || await button.count() !== 1 ||
          !await composer.isVisible() || !await button.isVisible())
        return deny('missing or ambiguous accessible composer/send control');
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
      await g159ConsumeOnce(journalDir, turnID, action);
      consumed = true; // After this point ANY failure is uncertain and cannot be retried.
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      await composer.fill(prompt, { timeout: 2000 });
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      if (await composer.count() !== 1 || await button.count() !== 1 ||
          !await button.isVisible() || !await button.isEnabled())
        return deny('send control changed after filling');
      // At most ONE user-visible click; never retry on timeout, navigation or lost ACK.
      await button.click({ timeout: 2000, noWaitAfter: true });
      return Object.freeze({ status: 'uncertain' as const, turnID });
    } finally { await session.detach().catch(() => {}); }
  } catch (error) {
    if (consumed) throw new Error('G159_SEND_UNCERTAIN: consumed before UI effect; do not replay');
    throw error;
  } finally {
    discovery.close();
    await browser?.close(); // detach CDP client, DO NOT close user's actual Chrome
  }
}
