/** G159: explicit, user-approved ONE-shot UI submission in an EXISTING Chrome tab.
 * No OS/Desktop attestation; never auto-retry, authenticate, bypass CAPTCHA or inspect secrets. */
import { createHash } from 'node:crypto';
import { MAX_PROMPT_CHARS } from '../core/prompt-bound.js';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { CdpPage, cdpTargets, type CdpSessionLike } from '../browser/cdp-page.js';
import { conversationRequired } from '../browser/tab-page-state.js';
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
  '[role="textbox"][contenteditable="true"][data-testid="composer-input"],' +
  'div[role="textbox"][contenteditable="true"]';
const SEND = 'button[data-testid="send-button"],button[aria-label="Send message"],' +
  'button[aria-label="Send prompt"],button[aria-label="Envoyer le message"],' +
  'button[aria-label="Envoyer"],button[aria-label="Send"]';

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

async function cdpFrame(session: CdpSessionLike): Promise<string> {
  const result = await session.send('Page.getFrameTree') as
    { frameTree?: { frame?: { id?: unknown; loaderId?: unknown; url?: unknown } } };
  const frame = result.frameTree?.frame;
  if (typeof frame?.id !== 'string' || !frame.id ||
      typeof frame?.loaderId !== 'string' || !frame.loaderId ||
      typeof frame?.url !== 'string' || !frame.url)
    return deny('CDP document identity unavailable');
  return frame.id + '\0' + frame.loaderId + '\0' + frame.url;
}

/** Returns UNCERTAIN, never provider-accepted. A click may have landed before transport loss. */
export async function g159SendChatgptOnce(request: G159SendRequest): Promise<{
  readonly status: 'uncertain'; readonly turnID: string;
}> {
  const { endpoint, tabID, sessionID, turnID, prompt, journalDir, consent } = request;
  if (!id(tabID) || !id(sessionID) || !id(turnID) ||
      typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt) ||
      typeof consent?.approveSend !== 'function' ||
      typeof consent?.isStillApproved !== 'function') return deny('invalid request or missing explicit send authorization');
  const discovery = new ExplicitCdpReadBridge(endpoint, consent);
  let page: CdpPage | undefined;
  let consumed = false;
  /** Only for the best-effort cleanup of the draft WE typed (never a retry). */
  let selectedPage: CdpPage | undefined;
  try {
    await discovery.open();
    const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
    if (!tab || tab.providerID !== 'chatgpt' || new URL(tab.url).origin !== 'https://chatgpt.com')
      return deny('selected ChatGPT tab missing');
    const home = conversationRequired('chatgpt', tab.url);
    if (home) return deny(home);
    const action: G159SendAction = Object.freeze({
      sessionID, turnID, tabID, generation: tab.generation, url: tab.url,
      providerID: 'chatgpt', promptSHA256: sha(prompt),
    });
    // Resolve the tab through the inventory it advertises, then speak to THAT
    // TAB'S OWN endpoint: Playwright's page enumeration is unreliable on Chrome
    // 155 (see cdp-page.ts), and the tab-local endpoint is authoritative. The
    // origin is checked BEFORE opening, so a mismatched tab is never connected to.
    const targets = (await cdpTargets(endpoint)).filter((target) => target.id === tabID);
    if (targets.length > 1) return deny('ambiguous duplicate CDP tab');
    if (targets.length !== 1 || targets[0]!.url !== tab.url) return deny('selected page/URL mismatch');
    page = await CdpPage.open(targets[0]!, { revive: true });
    selectedPage = page;
    const selected = page;
    const session = await selected.session();
    try {
      const firstFrame = await cdpFrame(session);
      const recheck = async () => {
        await discovery.verify(tab);
        if (selected.url() !== tab.url || await cdpFrame(session) !== firstFrame)
          return deny('navigation or document generation replaced');
      };
      const composer = selected.locator(COMPOSER);
      await recheck();
      // The current ChatGPT UI only mounts its send control once the composer
      // has content, so the composer is the pre-fill requirement; the send
      // control is required (and re-verified) AFTER the fill, before the click.
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
      await g159ConsumeOnce(journalDir, turnID, action);
      consumed = true; // After this point ANY failure is uncertain and cannot be retried.
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      await composer.fill(prompt, { timeout: 2000 });
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      const button = selected.locator(SEND);
      if (await composer.count() !== 1 || await button.count() !== 1 ||
          !await button.isVisible() || !await button.isEnabled())
        return deny('send control changed after filling');
      // At most ONE user-visible click; never retry on timeout, navigation or lost ACK.
      await button.click({ timeout: 2000, noWaitAfter: true });
      return Object.freeze({ status: 'uncertain' as const, turnID });
    } finally { await session.detach().catch(() => {}); }
  } catch (error) {
    if (consumed) {
      // A consumed attempt is never replayed. Best effort only: remove the prompt
      // WE typed when no click landed, so a failed or killed turn never leaves our
      // text in the user's composer (otherwise every later turn is refused with
      // 'nonempty user draft cannot be replaced'). Observed live 2026-10-19 on
      // ChatGPT and DeepSeek; Qwen and Mistral already carried this.
      // Clear ONLY an untouched copy of the prompt WE just typed. If anyone edited
      // the composer in the meantime, their text is left alone: a draft is never
      // silently overwritten.
      try {
        if (selectedPage) {
          const box = selectedPage.locator(COMPOSER);
          if (await box.evaluate((el) => ((el as HTMLTextAreaElement | HTMLInputElement).value ?? el.textContent ?? '')) === prompt)
            await box.fill('', { timeout: 1000 });
        }
      } catch { /* ignore */ }
      throw new Error('G159_SEND_UNCERTAIN: consumed before UI effect; do not replay');
    }
    throw error;
  } finally {
    discovery.close();
    await page?.close(); // close OUR socket only; DO NOT close the user's tab
  }
}
