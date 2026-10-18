/** Bounded, read-only DOM bodies for independently observed provider layouts.
 * All selectors are tentative until verified against an authenticated UI. */
import { chromium, type Browser, type Page } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from '../browser/explicit-cdp-read.js';
import { readPlainFields } from '../core/adapter-contract.js';
import { assertOpaqueID, type TurnEvent } from '../core/browser-port.js';

export type OtherProviderID = 'deepseek' | 'gemini' | 'mistral' | 'qwen';
export type OtherResponse = { readonly messageKey: string; readonly text: string };
export interface OtherReadConsent extends CdpConsent {
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
}
const KEY = /^[\w:.-]{1,256}$/;

/** Runs within a selected provider page; NEVER reads prompts or reasoning panels. */
export function g160ReadOtherDOM(provider: OtherProviderID): OtherResponse | null {
  let nodes: Element[];
  if (provider === 'deepseek') {
    nodes = [...document.querySelectorAll('.ds-assistant-message-main-content')];
  } else if (provider === 'gemini') {
    nodes = [...document.querySelectorAll('model-response')];
  } else if (provider === 'mistral') {
    nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  } else return null; // Qwen DOM layout has not been independently confirmed.
  if (!nodes.length || nodes.length > 128) return null;
  const root = nodes.at(-1)!;
  const content = provider === 'deepseek' ? [root] : provider === 'gemini'
    ? [...root.querySelectorAll('message-content.model-response-text .markdown')]
    : [...root.querySelectorAll('.markdown')];
  if (content.length !== 1) return null; // No broad text fallback: reasoning/user contamination.
  let keyNode: Element | null = root;
  let key: string | null = null;
  for (let i = 0; i < 3 && keyNode && !key; i++, keyNode = keyNode.parentElement) {
    key = keyNode.getAttribute('data-message-id') ?? keyNode.getAttribute('data-turn-id') ??
      keyNode.getAttribute('data-response-id') ?? keyNode.id ?? null;
  }
  if (!key || !KEY.test(key)) return null; // Indices/text hashes are not stable turn identity.
  const text = content[0].textContent ?? '';
  if (!text || text.length > 16_000) return null;
  return { messageKey: key, text };
}

/** Uses the ACTUAL existing user-selected Chromium tab and exact DOM reader. */
export class G160OtherProviderObserver {
  private closed = false;
  private constructor(
    private readonly discovery: ExplicitCdpReadBridge,
    private readonly connection: Browser,
    private readonly page: Page,
    private readonly tab: CdpTab,
    private readonly provider: OtherProviderID,
    private readonly consent: OtherReadConsent,
  ) {}

  static async attach(endpoint: string, tabID: string, provider: OtherProviderID,
    consent: OtherReadConsent): Promise<G160OtherProviderObserver> {
    if (!['deepseek', 'gemini', 'mistral'].includes(provider))
      throw new Error('G160 provider DOM not independently verified');
    if (typeof tabID !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(tabID) ||
        typeof consent?.allowAssistantText !== 'function')
      throw new Error('G160 explicit tab and per-read consent required');
    const discovery = new ExplicitCdpReadBridge(endpoint, consent);
    let connection: Browser | undefined;
    try {
      await discovery.open();
      const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
      if (!tab || tab.providerID !== provider) throw new Error('G160 provider/tab mismatch');
      connection = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
      let selected: Page | undefined;
      for (const context of connection.contexts()) for (const page of context.pages()) {
        const session = await context.newCDPSession(page);
        try {
          if ((await session.send('Target.getTargetInfo')).targetInfo?.targetId === tabID) {
            if (selected) throw new Error('G160 ambiguous CDP target');
            selected = page;
          }
        } finally { await session.detach(); }
      }
      if (!selected || selected.url() !== tab.url) throw new Error('G160 target identity mismatch');
      await discovery.verify(tab);
      return new G160OtherProviderObserver(discovery, connection, selected, tab, provider, consent);
    } catch (error) {
      await connection?.close();
      discovery.close();
      throw error;
    }
  }

  private async authorize(): Promise<void> {
    if (this.closed) throw new Error('G160 attachment closed');
    await this.discovery.verify(this.tab);
    if (await this.consent.allowAssistantText(this.tab) !== true)
      throw new Error('G160 assistant reading revoked');
    await this.discovery.verify(this.tab);
  }

  async sample(): Promise<OtherResponse | null> {
    await this.authorize();
    const raw = await this.page.evaluate(g160ReadOtherDOM, this.provider);
    await this.authorize();
    if (raw === null) return null;
    const parsed = readPlainFields(raw, ['messageKey', 'text']);
    if (!parsed.ok) throw new Error('G160 invalid DOM snapshot');
    const key = parsed.fields.get('messageKey'), text = parsed.fields.get('text');
    if (typeof key !== 'string' || !KEY.test(key) ||
        typeof text !== 'string' || !text || text.length > 16_000)
      throw new Error('G160 invalid assistant content');
    return Object.freeze({ messageKey: key, text });
  }

  async *observe(turnID: string, messageKey: string, polls = 12): AsyncGenerator<TurnEvent> {
    assertOpaqueID(turnID, 'turnID');
    if (!KEY.test(messageKey) || !Number.isSafeInteger(polls) || polls < 1 || polls > 32)
      throw new Error('G160 invalid selected answer/budget');
    let seen = '', seq = 0;
    for (let i = 0; i < polls; i++) {
      const found = await this.sample();
      if (!found || found.messageKey !== messageKey) throw new Error('G160 answer replaced');
      if (!found.text.startsWith(seen)) throw new Error('G160 answer rewritten/uncertain');
      const pending = found.text.slice(seen.length);
      for (let j = 0; j < pending.length; j += 4096) {
        yield Object.freeze({ kind: 'text' as const, turnID, seq: ++seq,
          value: pending.slice(j, j + 4096) });
      }
      seen = found.text;
      if (i + 1 < polls) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // DOM silence does not prove completion; never fabricate a finished event.
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.discovery.close();
    await this.connection.close(); // CDP detach, NOT the original browser process.
  }
}
