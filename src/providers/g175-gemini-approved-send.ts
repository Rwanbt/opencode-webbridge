/** G175: explicit, user-approved ONE-shot UI submission in an EXISTING Gemini tab.
 *
 *  Mirrors the reviewed G159/G174 invariants exactly: the operator-declared
 *  loopback tab is the authorization, the durable one-shot is consumed BEFORE any
 *  UI effect, and a consumed attempt is never replayed. No OS/Desktop attestation;
 *  never auto-retry, authenticate, bypass CAPTCHA or inspect secrets.
 *
 *  Selectors observed on the real authenticated Gemini UI (2026-10-18): the
 *  composer is the single visible div[role="textbox"][contenteditable="true"]
 *  (aria-label "Saisissez un prompt pour Gemini"); the send control is a Material
 *  icon button aria-label "Envoyer un message", mounted only once the composer has
 *  content, so it is resolved AFTER the fill.
 */
import { createHash } from 'node:crypto';
import { MAX_PROMPT_CHARS } from '../core/prompt-bound.js';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { CdpPage, cdpTargets, type CdpSessionLike } from '../browser/cdp-page.js';
import { ExplicitCdpReadBridge, type CdpConsent } from '../browser/explicit-cdp-read.js';

export interface G175SendAction {
  readonly sessionID: string;
  readonly turnID: string;
  readonly tabID: string;
  readonly generation: number;
  readonly url: string;
  readonly providerID: 'gemini';
  readonly promptSHA256: string;
}
export interface G175SendConsent extends CdpConsent {
  readonly approveSend: (action: Readonly<G175SendAction>, promptToDisplay: string) => Promise<boolean>;
  readonly isStillApproved: (action: Readonly<G175SendAction>) => boolean;
}
export interface G175SendRequest {
  readonly endpoint: string;
  readonly tabID: string;
  readonly sessionID: string;
  readonly turnID: string;
  readonly prompt: string;
  readonly journalDir: string;
  readonly consent: G175SendConsent;
}

const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const deny = (reason: string): never => { throw new Error('G175 send refused: ' + reason); };
const COMPOSER = 'div[role="textbox"][contenteditable="true"]:visible';
const SEND = 'button[aria-label="Envoyer un message"]:visible,button[aria-label="Send message"]:visible';
const CHAT_ORIGIN = 'https://gemini.google.com';

/** Durable consume BEFORE any UI effect. No reset/rollback method exists. */
export async function g175ConsumeOnce(journalDir: string, turnID: string,
  action: G175SendAction): Promise<void> {
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

const frameKey = async (session: CdpSessionLike): Promise<string> => {
  const result = await session.send('Page.getFrameTree') as
    { frameTree?: { frame?: unknown } };
  return JSON.stringify(result?.frameTree?.frame ?? null);
};

export async function g175SendGeminiOnce(request: G175SendRequest): Promise<{
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
  let page: CdpPage | undefined;
  let consumed = false;
  /** Only for the best-effort cleanup of the draft WE typed (never a retry). */
  let selectedPage: CdpPage | undefined;
  try {
    await discovery.open();
    const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
    if (!tab || tab.providerID !== 'gemini' || new URL(tab.url).origin !== CHAT_ORIGIN)
      return deny('selected Gemini tab missing');
    const action: G175SendAction = Object.freeze({
      sessionID, turnID, tabID, generation: tab.generation, url: tab.url,
      providerID: 'gemini', promptSHA256: sha(prompt),
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
      const firstFrame = await frameKey(session);
      const recheck = async () => {
        await discovery.verify(tab);
        if (selected.url() !== tab.url || await frameKey(session) !== firstFrame)
          return deny('navigation or document generation replaced');
      };
      const composer = selected.locator(COMPOSER);
      await recheck();
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
      await g175ConsumeOnce(journalDir, turnID, action);
      consumed = true;
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      await composer.fill(prompt, { timeout: 2000 });
      await recheck();
      if (consent.isStillApproved(action) !== true) return deny('send authorization revoked');
      const button = selected.locator(SEND);
      if (await composer.count() !== 1 || await button.count() !== 1 || !await button.isVisible())
        return deny('send control changed after filling');
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
      throw new Error('G175_SEND_UNCERTAIN: consumed before UI effect; do not replay');
    }
    throw error;
  } finally {
    discovery.close();
    await page?.close(); // close OUR socket only; DO NOT close the user's tab
  }
}
