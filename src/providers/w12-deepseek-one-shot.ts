/** W12: operator-approved one-shot DeepSeek UI effect on an explicitly selected Chrome target.
 * Selectors are fixture candidates; no live DeepSeek compatibility or completion is claimed. */
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent } from '../browser/explicit-cdp-read.js';
import { assertCdpDocumentEpoch, readCdpDocumentEpoch } from '../browser/cdp-document-epoch.js';
import { g159ConsumeOnce, type G159SendAction } from './g159-chatgpt-approved-send.js';

export interface W12DeepSeekAction {
  readonly providerID: 'deepseek';
  readonly sessionID: string;
  readonly turnID: string;
  readonly tabID: string;
  readonly generation: number;
  readonly url: string;
  readonly promptSHA256: string;
}
export interface W12Consent extends CdpConsent {
  /** Display the exact prompt in trusted operator UI before approving this action. */
  readonly approveSend: (action: Readonly<W12DeepSeekAction>, prompt: string) => Promise<boolean>;
  /** Host-controlled synchronous revocation, never supplied by the page or model. */
  readonly isStillApproved: (action: Readonly<W12DeepSeekAction>) => boolean;
}
export interface W12Request {
  readonly endpoint: string;
  readonly tabID: string;
  readonly sessionID: string;
  readonly turnID: string;
  readonly prompt: string;
  readonly journalDir: string;
  readonly consent: W12Consent;
  readonly signal?: AbortSignal;
}
const fail = (reason: string): never => { throw new Error('W12 send refused: ' + reason); };
const validID = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
const sha = (input: string) => createHash('sha256').update(input).digest('hex');
// Exact selectors only. Broad textboxes or arbitrary icon buttons are unsafe.
const EDITOR = 'textarea[data-testid="deepseek-chat-input"],textarea[aria-label="Message DeepSeek"]';
const SEND = 'button[data-testid="deepseek-send-button"],button[aria-label="Send message"]';

/** Success is deliberately UNCERTAIN, even after a click; never replay automatically. */
export async function w12SendDeepSeekOnce(input: W12Request): Promise<{
  readonly status: 'uncertain'; readonly turnID: string;
}> {
  const { endpoint, tabID, sessionID, turnID, prompt, journalDir, consent, signal } = input;
  if (!validID(tabID) || !validID(sessionID) || !validID(turnID) ||
      typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(prompt) ||
      typeof consent?.approveSend !== 'function' ||
      typeof consent?.isStillApproved !== 'function' || typeof journalDir !== 'string')
    return fail('invalid input or missing per-action authorization');
  if (signal?.aborted) return fail('cancelled');
  const discovery = new ExplicitCdpReadBridge(endpoint, consent);
  let browser: Browser | undefined;
  let consumed = false;
  try {
    await discovery.open();
    if (signal?.aborted) return fail('cancelled');
    const tab = (await discovery.tabs()).find((item) => item.tabID === tabID);
    if (!tab || tab.providerID !== 'deepseek' ||
        new URL(tab.url).origin !== 'https://chat.deepseek.com')
      return fail('selected DeepSeek tab or origin missing');
    const action: W12DeepSeekAction = Object.freeze({
      providerID: 'deepseek', sessionID, turnID, tabID, generation: tab.generation,
      url: tab.url, promptSHA256: sha(prompt),
    });
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    let page: Page | undefined;
    for (const context of browser.contexts()) for (const candidate of context.pages()) {
      const cdp = await context.newCDPSession(candidate);
      try {
        if ((await cdp.send('Target.getTargetInfo')).targetInfo?.targetId === tabID) {
          if (page) return fail('duplicate selected CDP target');
          page = candidate;
        }
      } finally { await cdp.detach(); }
    }
    if (!page || page.url() !== tab.url) return fail('CDP target URL changed');
    const selected = page;
    const epoch = await readCdpDocumentEpoch(selected, tab.url);
    const recheck = async () => {
      if (signal?.aborted) return fail('cancelled');
      await discovery.verify(tab);
      assertCdpDocumentEpoch(await readCdpDocumentEpoch(selected, tab.url), epoch);
      if (signal?.aborted) return fail('cancelled');
      if (consent.isStillApproved(action) !== true) return fail('authorization revoked');
    };
    // Discovery permission does not grant send permission. Check controls without reading
    // any cookies, credentials, conversation content or reasoning panels.
    const editor = selected.locator(EDITOR), button = selected.locator(SEND);
    await discovery.verify(tab);
    assertCdpDocumentEpoch(await readCdpDocumentEpoch(selected, tab.url), epoch);
    if (signal?.aborted) return fail('cancelled');
    if (await editor.count() !== 1 || await button.count() !== 1 ||
        !await editor.isVisible() || !await button.isVisible())
      return fail('missing or ambiguous send controls');
    if ((await editor.inputValue()).trim()) return fail('user draft cannot be overwritten');
    await discovery.verify(tab);
    assertCdpDocumentEpoch(await readCdpDocumentEpoch(selected, tab.url), epoch);
    if (signal?.aborted) return fail('cancelled');
    if (await consent.approveSend(action, prompt) !== true) return fail('operator declined');
    await recheck();
    if ((await editor.inputValue()).trim()) return fail('draft changed during approval');
    await recheck();
    // The reviewed G159 journal consumes the turn across provider adapters. It records
    // only a hash of this DeepSeek action and never the raw prompt or credentials.
    await g159ConsumeOnce(journalDir, turnID, action as unknown as G159SendAction);
    consumed = true;
    await recheck();
    await editor.fill(prompt, { timeout: 2000 });
    await recheck();
    if (await editor.count() !== 1 || await button.count() !== 1 ||
        await editor.inputValue() !== prompt || !await editor.isVisible() ||
        !await button.isVisible() || !await button.isEnabled())
      return fail('composer or send control changed');
    await button.click({ trial: true, timeout: 2000 });
    await recheck();
    // At most one click; transport loss or navigation after here is irrecoverably uncertain.
    await button.click({ noWaitAfter: true, timeout: 2000 });
    return Object.freeze({ status: 'uncertain', turnID });
  } catch (error) {
    if (consumed) throw new Error('W12_SEND_UNCERTAIN: journal consumed; never replay');
    throw error;
  } finally {
    discovery.close();
    await browser?.close(); // Only detach CDP; do not terminate the owned Chrome process.
  }
}
