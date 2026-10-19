import type { Page } from 'playwright';

/** A tab ID and unchanged URL do NOT prove a document survived a full reload. */
export interface CdpDocumentEpoch {
  readonly frameID: string;
  readonly loaderID: string;
  readonly url: string;
}

/** Two reads taken at different moments from different sources (a fresh CDP
 *  inventory versus Playwright's cached page URL) cannot be compared as strings:
 *  a client-side navigation between them is a race, not a mismatch. What must
 *  hold is that both sides are the SAME ORIGIN, which is the security-relevant
 *  part. The document's own frame tree stays authoritative for continuity. */
export function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

export async function readCdpDocumentEpoch(page: Page, expectedURL: string): Promise<CdpDocumentEpoch> {
  const session = await page.context().newCDPSession(page);
  try {
    const tree = await session.send('Page.getFrameTree');
    const frame = tree?.frameTree?.frame;
    if (typeof frame?.id !== 'string' || !frame.id ||
        typeof frame?.loaderId !== 'string' || !frame.loaderId ||
        typeof frame?.url !== 'string' || !sameOrigin(frame.url, expectedURL)) {
      throw new Error('CDP main document identity or origin unavailable');
    }
    return Object.freeze({ frameID: frame.id, loaderID: frame.loaderId, url: frame.url });
  } finally { await session.detach(); }
}

export function assertCdpDocumentEpoch(current: CdpDocumentEpoch, expected: CdpDocumentEpoch): void {
  if (current.frameID !== expected.frameID || current.loaderID !== expected.loaderID ||
      current.url !== expected.url) throw new Error('CDP document replaced at same or different URL');
}
