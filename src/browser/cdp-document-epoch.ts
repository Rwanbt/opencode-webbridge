import type { Page } from 'playwright';
import type { CdpSessionLike } from './cdp-page.js';

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

/** A source this read can open a CDP session on. Playwright's Page satisfies the
 *  union arm directly; the CDP driver exposes `cdpSession()`. The discriminator
 *  is a method ONLY the driver has, so a Playwright page can never be mistaken
 *  for one -- and the driver's session can never be opened through a Playwright
 *  call that would pass it a bogus page argument. */
export interface CdpEpochSource {
  cdpSession(): Promise<CdpSessionLike>;
}

/** Exactly one session per read, and this function releases it either way:
 *  Playwright's is opened for the read and detached in the finally; the driver's
 *  is the single session its attachment owns, whose detach() is a no-op. */
async function openEpochSession(source: CdpEpochSource | Page): Promise<CdpSessionLike> {
  if ('cdpSession' in source) return source.cdpSession();
  return source.context().newCDPSession(source);
}

export async function readCdpDocumentEpoch(
  source: CdpEpochSource | Page, expectedURL: string,
): Promise<CdpDocumentEpoch> {
  const session = await openEpochSession(source);
  try {
    const tree = await session.send('Page.getFrameTree') as
      { frameTree?: { frame?: { id?: unknown; loaderId?: unknown; url?: unknown } } };
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
