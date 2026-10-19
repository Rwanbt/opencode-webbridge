/** Read only the selected assistant answer from an explicitly attached Chromium tab.
 * The CDP port is user-declared, NOT Core/OS/Desktop attestation. No input or writes. */
import { chromium, type Browser, type Page } from 'playwright';
import { ExplicitCdpReadBridge, type CdpConsent, type CdpTab } from './explicit-cdp-read.js';
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
    private readonly connection: Browser,
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
    let connection: Browser | undefined;
    try {
      await discovery.open();
      const tab = (await discovery.tabs()).find((t) => t.tabID === tabID);
      if (!tab || tab.providerID !== 'chatgpt') throw new Error('G157 exact ChatGPT tab not selected');
      // Connect to the EXISTING browser: never launch another or modify its profile.
      connection = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
      let selected: Page | undefined;
      for (const context of connection.contexts()) {
        for (const page of context.pages()) {
          const session = await context.newCDPSession(page);
          try {
            const result = await session.send('Target.getTargetInfo');
            if (result.targetInfo?.targetId === tab.tabID) {
              if (selected) throw new Error('G157 ambiguous duplicate CDP target');
              selected = page;
            }
          } finally { await session.detach(); }
        }
      }
      if (!selected || !sameOrigin(selected.url(), tab.url)) throw new Error('G157 target identity/origin mismatch');
      await discovery.verify(tab);
      const page = selected;
      const documentEpoch = await readCdpDocumentEpoch(page, tab.url);
      await discovery.verify(tab);
      const verifyDocument = async () => {
        assertCdpDocumentEpoch(await readCdpDocumentEpoch(page, tab.url), documentEpoch);
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
          const result = await page.evaluate(g156ChatgptReadDOM);
          await discovery.verify(tab);
          await verifyDocument();
          return result as R;
        },
      };
      const expected = await current();
      const observer = await G156ChatgptObserver.attach(host, 'chatgpt', expected);
      return new G157ChatgptCdpObserver(discovery, connection, tab, observer);
    } catch (error) {
      await connection?.close(); // disconnect CDP client; do not terminate existing Chrome
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
    await this.connection.close(); // detach this CDP client only
  }
}
