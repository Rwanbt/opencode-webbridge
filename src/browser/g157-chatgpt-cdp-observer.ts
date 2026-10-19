/** Read only the selected assistant answer from an explicitly attached Chromium tab.
 * The CDP port is user-declared, NOT Core/OS/Desktop attestation. No input or writes. */
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from './explicit-cdp-read.js';
import { CdpPage, cdpTargets } from './cdp-page.js';
import { readCdpDocumentEpoch, assertCdpDocumentEpoch, sameOrigin } from './cdp-document-epoch.js';
import {
  G156ChatgptObserver, g156ChatgptReadDOM, type G156Attachment,
} from '../providers/g156-chatgpt-dom.js';

export interface G157Consent extends CdpConsent {
  /** Independent per-read authorization (may be revoked during any await). */
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
}

export class G157ChatgptCdpObserver {
  private closed = false;
  private constructor(
    private readonly discovery: ExplicitCdpReadBridge,
    /** The driver owns this attachment's socket. Closing it detaches THIS client
     *  only; it never terminates the browser or the user's tab. */
    private readonly page: CdpPage,
    private readonly tab: CdpTab,
    private readonly observer: G156ChatgptObserver,
  ) {}

  /** Attached target identity: a caller may persist it and later refuse to
   *  resume onto a different tab or a replaced generation. */
  get scope(): { readonly tabID: string; readonly generation: number } {
    return Object.freeze({ tabID: this.tab.tabID, generation: this.tab.generation });
  }

  static async attach(endpoint: string, tabID: string, consent: G157Consent): Promise<G157ChatgptCdpObserver> {
    if (typeof tabID !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(tabID) ||
        typeof consent?.allowAssistantText !== 'function') throw new Error('G157 explicit tab and read consent required');
    const discovery = new ExplicitCdpReadBridge(endpoint, consent);
    let page: CdpPage | undefined;
    try {
      await discovery.open();
      const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
      if (!tab || tab.providerID !== 'chatgpt') throw new Error('G157 exact ChatGPT tab not selected');
      // Resolve the tab through the inventory the browser advertises, then speak
      // to THAT TAB'S OWN endpoint. Playwright's connectOverCDP enumerates pages
      // through the browser endpoint, and on Chrome 155 that enumeration is
      // unreliable (measured: 5 pages, then 1, then 0 -- same version, same
      // browser, same five tabs present in the inventory). Every turn then failed
      // at attach. The tab-local endpoint is authoritative, and the identity is
      // the inventory's own target id, so the target is never guessed.
      const targets = (await cdpTargets(endpoint)).filter((target) => target.id === tab.tabID);
      if (targets.length > 1) throw new Error('G157 ambiguous duplicate CDP target');
      // The origin is checked BEFORE opening anything: a mismatched tab is never
      // even connected to.
      if (targets.length !== 1 || !sameOrigin(targets[0]!.url, tab.url))
        throw new Error('G157 target identity/origin mismatch');
      page = await CdpPage.open(targets[0]!, { revive: true });
      await discovery.verify(tab);
      const documentEpoch = await readCdpDocumentEpoch(page, tab.url);
      await discovery.verify(tab);
      const verifyDocument = async () => {
        assertCdpDocumentEpoch(await readCdpDocumentEpoch(page!, tab.url), documentEpoch);
      };
      const current = async () => {
        const latest = (await discovery.tabs()).find((t) => t.tabID === tab.tabID);
        if (!latest || latest.generation !== tab.generation || latest.url !== tab.url)
          throw new Error('G157 tab replaced or revoked');
        await verifyDocument();
        return { tabID: latest.tabID, generation: 'gen_' + latest.generation, url: latest.url };
      };
      const host: G156Attachment = {
        current,
        authorizeRead: async () => {
          await discovery.verify(tab);
          await verifyDocument();
          if (await consent.allowAssistantText(tab) !== true)
            throw new Error('G157 assistant text permission revoked');
          await discovery.verify(tab);
          await verifyDocument();
        },
        evaluate: async <R>(reader: () => R): Promise<R> => {
          // Never accept page-authored or caller-provided functions. This fixed
          // audited reader uses DOM selectors only and has no write operations.
          if (reader !== g156ChatgptReadDOM) throw new Error('G157 unsupported CDP evaluation');
          await discovery.verify(tab);
          await verifyDocument();
          const result = await page!.evaluate(g156ChatgptReadDOM);
          await discovery.verify(tab);
          await verifyDocument();
          return result as R;
        },
      };
      const expected = await current();
      const observer = await G156ChatgptObserver.attach(host, 'chatgpt', expected);
      return new G157ChatgptCdpObserver(discovery, page, tab, observer);
    } catch (error) {
      await page?.close(); // close OUR socket; never the user's tab
      discovery.close();
      throw error;
    }
  }

  async sample() {
    if (this.closed) throw new Error('G157 CDP attachment closed');
    return this.observer.sample();
  }

  async *observe(turnID: string, selectedMessageKey: string, polls = 12) {
    if (this.closed) throw new Error('G157 CDP attachment closed');
    yield* this.observer.observe(turnID, selectedMessageKey, { polls });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.discovery.close();
    await this.page.close(); // close OUR socket only; never the user's tab
  }
}
