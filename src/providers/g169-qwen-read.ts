/** Qwen browser capability probe; fixture-only DOM adapter until real Qwen UI is independently verified.
 * Never submit prompts, inspect credentials, or declare a commercial provider operational. */
import { chromium, type Browser, type Page } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from '../browser/explicit-cdp-read.js';
import { readCdpDocumentEpoch, assertCdpDocumentEpoch, sameOrigin, type CdpDocumentEpoch } from '../browser/cdp-document-epoch.js';

export interface G169Consent extends CdpConsent {
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
  readonly isStillApproved: (tab: CdpTab) => boolean;
  readonly signal: AbortSignal;
}
export interface G169Probe {
  readonly providerID: 'qwen';
  readonly tabID: string;
  readonly generation: number;
  readonly documentBound: true;
  readonly liveSiteSelectorsVerified: false;
  readonly readStatus: 'NO_GO_UNVERIFIED_LIVE_QWEN_DOM';
}
export interface G169FixtureAnswer { readonly messageKey: string; readonly text: string }
const KEY = /^[A-Za-z0-9_.:-]{1,128}$/;
const fail = (why: string): never => { throw new Error('G169 Qwen denied: ' + why); };
const requireLive = (consent: G169Consent, tab: CdpTab, closed: boolean): void => {
  if (closed || consent.signal?.aborted || consent.isStillApproved(tab) !== true)
    fail('cancelled, closed or permission revoked');
};

/** Fixed, narrowly bounded DOM reader. Marker is a TEST FIXTURE contract, NOT proof of real Qwen. */
export function g169ReadInterceptedFixture(messageKey: string): G169FixtureAnswer | null {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(messageKey)) return null;
  const fixture = document.querySelectorAll(
    'main[data-webbridge-g169-fixture="intercepted-qwen-v1"]',
  );
  if (fixture.length !== 1) return null;
  const matching = [...fixture[0].querySelectorAll(
    'article[data-webbridge-g169-speaker="assistant"][data-message-id]',
  )].filter((node) => node.getAttribute('data-message-id') === messageKey);
  if (matching.length !== 1) return null; // Explicit ID, not last-message heuristics.
  const root = matching[0];
  const bodies = root.querySelectorAll(':scope > [data-webbridge-g169-body]');
  if (bodies.length !== 1 ||
      bodies[0].querySelector('input,textarea,select,[contenteditable],[type="password"],' +
        '[data-webbridge-g169-reasoning],[data-webbridge-g169-speaker="user"]')) return null;
  const text = bodies[0].textContent ?? '';
  if (!text.trim() || text.length > 8192) return null;
  return { messageKey, text };
}

export class G169QwenRead {
  private closed = false;
  private constructor(
    private readonly discovery: ExplicitCdpReadBridge,
    private readonly browser: Browser,
    private readonly page: Page,
    private readonly tab: CdpTab,
    private readonly epoch: CdpDocumentEpoch,
    private readonly consent: G169Consent,
  ) {}

  /** Attaches to ONE existing Chromium target; never launches or modifies Chrome. */
  static async attach(endpoint: string, tabID: string, consent: G169Consent): Promise<G169QwenRead> {
    if (typeof tabID !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(tabID) ||
        typeof consent?.allowAssistantText !== 'function' ||
        typeof consent?.isStillApproved !== 'function' || !consent?.signal)
      return fail('explicit tab, per-read consent and cancellation signal required');
    const discovery = new ExplicitCdpReadBridge(endpoint, consent);
    let browser: Browser | undefined;
    try {
      if (consent.signal.aborted) return fail('caller cancelled before CDP discovery');
      await discovery.open();
      const tab = (await discovery.tabs()).find((item) => item.tabID === tabID);
      if (!tab || tab.providerID !== 'qwen' || new URL(tab.url).origin !== 'https://chat.qwen.ai')
        return fail('exact Qwen target and origin required');
      requireLive(consent, tab, false);
      browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
      let selected: Page | undefined;
      for (const context of browser.contexts()) for (const candidate of context.pages()) {
        const probe = await context.newCDPSession(candidate);
        try {
          if ((await probe.send('Target.getTargetInfo')).targetInfo?.targetId === tabID) {
            if (selected) return fail('duplicate CDP target ID');
            selected = candidate;
          }
        } finally { await probe.detach(); }
      }
      if (!selected || !sameOrigin(selected.url(), tab.url)) return fail('target origin replaced');
      await discovery.verify(tab);
      const epoch = await readCdpDocumentEpoch(selected, tab.url);
      await discovery.verify(tab);
      requireLive(consent, tab, false);
      return new G169QwenRead(discovery, browser, selected, tab, epoch, consent);
    } catch (error) {
      await browser?.close().catch(() => {});
      discovery.close();
      throw error;
    }
  }

  private async check(): Promise<void> {
    requireLive(this.consent, this.tab, this.closed);
    await this.discovery.verify(this.tab);
    assertCdpDocumentEpoch(await readCdpDocumentEpoch(this.page, this.tab.url), this.epoch);
    requireLive(this.consent, this.tab, this.closed);
  }

  /** Useful real-browser readiness signal, with ZERO page text or unverified selector claims. */
  async probe(): Promise<G169Probe> {
    await this.check();
    const result = Object.freeze({
      providerID: 'qwen' as const, tabID: this.tab.tabID, generation: this.tab.generation,
      documentBound: true as const, liveSiteSelectorsVerified: false as const,
      readStatus: 'NO_GO_UNVERIFIED_LIVE_QWEN_DOM' as const,
    });
    await this.check();
    return result;
  }

  /** Real Qwen is ALWAYS closed to body reading; only an intercepted test fixture can opt in. */
  async sample(messageKey: string): Promise<G169FixtureAnswer | null> {
    if (process.env.G169_INTERCEPTED_FIXTURE !== '1') return fail('real Qwen DOM layout unverified');
    if (typeof messageKey !== 'string' || !KEY.test(messageKey)) return fail('invalid explicit message ID');
    await this.check();
    if (await this.consent.allowAssistantText(this.tab) !== true)
      return fail('assistant text permission denied');
    await this.check();
    const snapshot = await this.page.evaluate(g169ReadInterceptedFixture, messageKey);
    await this.check();
    if (snapshot === null) return null;
    if (snapshot.messageKey !== messageKey || typeof snapshot.text !== 'string' ||
        !snapshot.text || snapshot.text.length > 8192) return fail('invalid fixture answer');
    return Object.freeze({ messageKey, text: snapshot.text });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.discovery.close();
    await this.browser.close(); // Detach CDP connection only; user's Chromium keeps running.
  }
}
