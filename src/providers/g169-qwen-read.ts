/** Qwen browser capability probe; fixture-only DOM adapter until real Qwen UI is independently verified.
 * Never submit prompts, inspect credentials, or declare a commercial provider operational. */
import { CdpPage, cdpTargets } from '../browser/cdp-page.js';
import { conversationRequired } from '../browser/tab-page-state.js';
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
    /** The driver owns this attachment's socket: closing it detaches THIS client
     *  only, and never terminates the browser or the user's tab. */
    private readonly page: CdpPage,
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
    let page: CdpPage | undefined;
    try {
      if (consent.signal.aborted) return fail('caller cancelled before CDP discovery');
      await discovery.open();
      const tab = (await discovery.tabs()).find((item) => item.tabID === tabID);
      if (!tab || tab.providerID !== 'qwen' || new URL(tab.url).origin !== 'https://chat.qwen.ai')
        return fail('exact Qwen target and origin required');
      const home = conversationRequired('qwen', tab.url);
      if (home) return fail(home);
      requireLive(consent, tab, false);
      // Resolve the tab through the inventory it advertises, then speak to THAT
      // TAB'S OWN endpoint: Playwright's page enumeration is unreliable on Chrome
      // 155 (see cdp-page.ts), and the tab-local endpoint is authoritative. The
      // origin is checked BEFORE opening, so a mismatched tab is never connected to.
      const targets = (await cdpTargets(endpoint)).filter((target) => target.id === tabID);
      if (targets.length > 1) return fail('duplicate CDP target ID');
      if (targets.length !== 1 || !sameOrigin(targets[0]!.url, tab.url)) return fail('target origin replaced');
      page = await CdpPage.open(targets[0]!, { revive: true });
      await discovery.verify(tab);
      const epoch = await readCdpDocumentEpoch(page, tab.url);
      await discovery.verify(tab);
      requireLive(consent, tab, false);
      return new G169QwenRead(discovery, page, tab, epoch, consent);
    } catch (error) {
      await page?.close().catch(() => {});
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
    await this.page.close(); // close OUR socket only; user's Chromium keeps running
  }
}
