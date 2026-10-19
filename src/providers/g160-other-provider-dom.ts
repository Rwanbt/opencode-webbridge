/** Bounded, read-only DOM bodies for independently observed provider layouts.
 * All selectors are tentative until verified against an authenticated UI. */
import { CdpPage, cdpTargets } from '../browser/cdp-page.js';
import { conversationRequired, pageHasTurns } from '../browser/tab-page-state.js';
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from '../browser/explicit-cdp-read.js';
import { readCdpDocumentEpoch, assertCdpDocumentEpoch, sameOrigin, type CdpDocumentEpoch } from '../browser/cdp-document-epoch.js';
import { readPlainFields } from '../core/adapter-contract.js';
import { assertOpaqueID, type TurnEvent } from '../core/browser-port.js';

export type OtherProviderID = 'deepseek' | 'gemini' | 'mistral' | 'qwen';
export type OtherResponse = {
  readonly messageKey: string;
  readonly text: string;
  /** Provider-final evidence: the UI itself finalized THIS message. */
  readonly finalized: boolean;
};
export interface OtherReadConsent extends CdpConsent {
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
}
const KEY = /^[\w:.-]{1,256}$/;

/** Runs within a selected provider page; NEVER reads prompts or reasoning panels. */
export function g160ReadOtherDOM(provider: OtherProviderID): OtherResponse | null {
  // Browser page.evaluate serializes this function alone: NO module-scope closure.
  const documentKey = /^[\w:.-]{1,256}$/;
  let nodes: Element[];
  if (provider === 'deepseek') {
    nodes = [...document.querySelectorAll('.ds-assistant-message-main-content')];
  } else if (provider === 'gemini') {
    nodes = [...document.querySelectorAll('model-response')];
  } else if (provider === 'mistral') {
    nodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
  } else if (provider === 'qwen') {
    // Observed on the real authenticated Qwen UI (2026-10-18): each assistant
    // turn is a container with id "chat-response-message-<uuid>". The live list
    // held 4 such nodes for only 3 ".qwen-markdown" bodies (one container was an
    // empty/pending turn), so selecting the last node blindly could read
    // nothing. Keep only containers carrying exactly one answer body.
    nodes = [...document.querySelectorAll('[id^="chat-response-message-"]')]
      .filter((node) => node.querySelectorAll('.qwen-markdown').length === 1);
  } else return null;
  if (!nodes.length || nodes.length > 128) return null;
  const root = nodes.at(-1)!;
  const content = provider === 'deepseek' ? [root]
    : provider === 'qwen' ? [...root.querySelectorAll('.qwen-markdown')]
    : provider === 'gemini' ? [...root.querySelectorAll('model-response-content')]
    : [...root.querySelectorAll('[class*="markdown"]')]; // mistral (observed layout)
  if (content.length !== 1) return null; // No broad text fallback: reasoning/user contamination.
  let keyNode: Element | null = root;
  let key: string | null = null;
  for (let i = 0; i < 3 && keyNode && !key; i++, keyNode = keyNode.parentElement) {
    key = keyNode.getAttribute('data-message-id') ?? keyNode.getAttribute('data-turn-id') ??
      keyNode.getAttribute('data-response-id') ?? keyNode.id ?? null;
  }
  if (!key && provider === 'deepseek') {
    // Observed on the real authenticated UI (2026-10-18): DeepSeek exposes no
    // per-message id. The app's virtual-list item key paired with the
    // conversation id from the URL is the stable pair (never a text hash).
    const item = root.closest('[data-virtual-list-item-key]')
      ?.getAttribute('data-virtual-list-item-key') ?? null;
    const conversation = /\/a\/chat\/s\/([A-Za-z0-9-]{8,64})/.exec(location.pathname)?.[1] ?? null;
    if (item && /^\d{1,6}$/.test(item) && conversation) key = conversation + ':' + item;
  }
  if (!key || !documentKey.test(key)) return null; // No unstable indices/text hashes.
  const text = content[0].textContent ?? '';
  if (!text || text.length > 16_000) return null;
  // Provider-final evidence, observed live (2026-10-18). A finalized answer
  // exposes its OWN action bar; the user turn's controls ("Copier le message",
  // "Modifier le message", "Copier le prompt") never match, so a streaming turn
  // cannot borrow them. DOM silence is never used as proof.
  const labelOf = (el: Element): string =>
    el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.getAttribute('data-testid') ?? '';
  const FINAL = provider === 'gemini'
    ? /^copier$|^écouter$|^partager et exporter$|bonne réponse|mauvaise réponse|afficher plus d'options/i
    : provider === 'qwen'
      ? /^copier$|^régénérer$|^partager$|bonne réponse|mauvaise réponse|plus d'actions/i
      : /copy to clipboard|^rewrite$|^like$|^dislike$|lire à voix haute/i; // mistral
  // Observed on the real authenticated DeepSeek UI (2026-10-19): its finalized
  // answer DOES expose an action bar, but it is entirely ICON-ONLY — no
  // aria-label, no title, no data-* — so labels can never identify it. The bar
  // lives on the turn container (the answer body itself carries no controls) and
  // is recognised by the first path of its SVG icons.
  const DEEPSEEK_ICONS = ['M6.14929 4.02032', 'M7.92136 0.349152', 'M8.27868 0.811572',
    'M7.72451 15.1086', 'M9.31006 14.8936', 'M7.95889 1.52285'];
  const iconPrefix = (el: Element): string =>
    el.querySelector('svg path')?.getAttribute('d')?.slice(0, 20) ?? '';
  const finalToken = (el: Element): string | null => {
    if (provider === 'deepseek') {
      const prefix = iconPrefix(el);
      if (!prefix) return null;
      return DEEPSEEK_ICONS.find((icon) => prefix.startsWith(icon)) ?? null;
    }
    const label = labelOf(el);
    return label && FINAL.test(label) ? label : null;
  };
  const STOPPING = /stop|arr[êe]ter|abort|interrupt/i;
  // DeepSeek needs more distinct controls than a labelled bar: an icon-only bar
  // is easier to match by accident, so it must look like a complete action bar.
  const needed = provider === 'deepseek' ? 4 : 2;
  let finalControls = 0;
  let bar: Element | null = root;
  for (let i = 0; i < 4 && bar; i++, bar = bar.parentElement) {
    const tokens = new Set<string>();
    for (const b of bar.querySelectorAll('button,[role="button"]')) {
      const token = finalToken(b);
      if (token) tokens.add(token);
    }
    finalControls = Math.max(finalControls, tokens.size);
  }
  let generating = false;
  let seen = 0;
  for (const b of document.querySelectorAll('button,[role="button"],[data-testid*="stop" i]')) {
    if (++seen > 4000) break;
    if (STOPPING.test(labelOf(b))) { generating = true; break; }
  }
  const finalized = finalControls >= needed && !generating;
  return { messageKey: key, text, finalized };
}

/** Uses the ACTUAL existing user-selected Chromium tab and exact DOM reader. */
export class G160OtherProviderObserver {
  private closed = false;
  private constructor(
    private readonly discovery: ExplicitCdpReadBridge,
    /** The driver owns this attachment's socket: closing it detaches THIS client
     *  only, and never terminates the browser or the user's tab. */
    private readonly page: CdpPage,
    private readonly tab: CdpTab,
    private readonly provider: OtherProviderID,
    private readonly consent: OtherReadConsent,
    private readonly documentEpoch: CdpDocumentEpoch,
  ) {}

  static async attach(endpoint: string, tabID: string, provider: OtherProviderID,
    consent: OtherReadConsent): Promise<G160OtherProviderObserver> {
    if (!['deepseek', 'gemini', 'mistral', 'qwen'].includes(provider))
      throw new Error('G160 provider DOM not independently verified');
    if (typeof tabID !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(tabID) ||
        typeof consent?.allowAssistantText !== 'function')
      throw new Error('G160 explicit tab and per-read consent required');
    const discovery = new ExplicitCdpReadBridge(endpoint, consent);
    let page: CdpPage | undefined;
    try {
      await discovery.open();
      const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
      if (!tab || tab.providerID !== provider) throw new Error('G160 provider/tab mismatch');
      // Resolve the tab through the inventory it advertises, then speak to THAT
      // TAB'S OWN endpoint: Playwright's page enumeration is unreliable on Chrome
      // 155 (see cdp-page.ts), and the tab-local endpoint is authoritative. The
      // origin is checked BEFORE opening, so a mismatched tab is never connected to.
      const targets = (await cdpTargets(endpoint)).filter((target) => target.id === tabID);
      if (targets.length > 1) throw new Error('G160 ambiguous CDP target');
      if (targets.length !== 1 || !sameOrigin(targets[0]!.url, tab.url))
        throw new Error('G160 target identity/origin mismatch');
      page = await CdpPage.open(targets[0]!, { revive: true });
      const home = conversationRequired(provider, tab.url, await pageHasTurns(page));
      if (home) throw new Error('G160 ' + home);
      await discovery.verify(tab);
      const documentEpoch = await readCdpDocumentEpoch(page, tab.url);
      await discovery.verify(tab);
      return new G160OtherProviderObserver(discovery, page, tab, provider, consent, documentEpoch);
    } catch (error) {
      await page?.close();
      discovery.close();
      throw error;
    }
  }

  /** Attached target identity, mirroring G157: a caller may persist it and later
   *  refuse to resume onto a different tab or a replaced generation. */
  get scope(): { readonly tabID: string; readonly generation: number } {
    return Object.freeze({ tabID: this.tab.tabID, generation: this.tab.generation });
  }

  private async authorize(): Promise<void> {
    if (this.closed) throw new Error('G160 attachment closed');
    await this.discovery.verify(this.tab);
    assertCdpDocumentEpoch(await readCdpDocumentEpoch(this.page, this.tab.url), this.documentEpoch);
    if (await this.consent.allowAssistantText(this.tab) !== true)
      throw new Error('G160 assistant reading revoked');
    await this.discovery.verify(this.tab);
    assertCdpDocumentEpoch(await readCdpDocumentEpoch(this.page, this.tab.url), this.documentEpoch);
  }

  async sample(): Promise<OtherResponse | null> {
    await this.authorize();
    const raw = await this.page.evaluate(g160ReadOtherDOM, this.provider);
    await this.authorize();
    if (raw === null) return null;
    const parsed = readPlainFields(raw, ['messageKey', 'text', 'finalized']);
    if (!parsed.ok) throw new Error('G160 invalid DOM snapshot');
    const key = parsed.fields.get('messageKey'), text = parsed.fields.get('text');
    const finalized = parsed.fields.get('finalized');
    if (typeof key !== 'string' || !KEY.test(key) ||
        typeof text !== 'string' || !text || text.length > 16_000 ||
        typeof finalized !== 'boolean')
      throw new Error('G160 invalid assistant content');
    return Object.freeze({ messageKey: key, text, finalized });
  }

  async *observe(turnID: string, messageKey: string, polls = 12): AsyncGenerator<TurnEvent> {
    assertOpaqueID(turnID, 'turnID');
    if (!KEY.test(messageKey) || !Number.isSafeInteger(polls) || polls < 1 || polls > 32)
      throw new Error('G160 invalid selected answer/budget');
    let seen = '', seq = 0;
    for (let i = 0; i < polls; i++) {
      const found = await this.sample();
      if (!found || found.messageKey !== messageKey) {
        // Distinguish "the UI no longer exposes a recognizable answer" from
        // "the answer was swapped for another turn": never a silent guess.
        if (!seen && !found) throw new Error('G160 no assistant answer found on the declared '
          + this.provider + ' tab (the UI may have changed; see docs/ADAPTERS-LIVE-RECON.fr.md)');
        throw new Error('G160 answer replaced');
      }
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
    await this.page.close(); // close OUR socket only; never the user's tab
  }
}
