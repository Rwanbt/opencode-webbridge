/** Common manually invoked, read-only browser progress on existing, authorized CDP targets.
 * A selected DOM message is NEVER proof of correlation to a sent prompt or provider finality. */
import type { CdpConsent, CdpTab, CdpProviderID } from '../browser/explicit-cdp-read.js';
import { G157ChatgptCdpObserver } from '../browser/g157-chatgpt-cdp-observer.js';
import { G160OtherProviderObserver } from '../providers/g160-other-provider-dom.js';
import { G169QwenRead } from '../providers/g169-qwen-read.js';

export interface G175Consent extends CdpConsent {
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
  /** Host-owned synchronous permission; do not derive from the web page. */
  readonly isStillApproved: (provider: CdpProviderID, tabID: string) => boolean;
}
export interface G175Request {
  readonly endpoint: string;
  readonly tabID: string;
  readonly provider: CdpProviderID;
  readonly turnID: string;
  /** Host/user-selected assistant ID; cannot be inferred as belonging to turnID. */
  readonly messageKey: string;
  readonly consent: G175Consent;
  readonly signal: AbortSignal;
  readonly polls?: number;
  readonly intervalMs?: number;
}
export type G175Event =
  | { readonly kind: 'candidate'; readonly turnID: string; readonly provider: CdpProviderID;
      readonly tabID: string; readonly messageKey: string; readonly seq: number;
      readonly text: string; readonly correlation: 'unverified-dom' }
  | { readonly kind: 'terminal'; readonly turnID: string; readonly provider: CdpProviderID;
      readonly status: 'uncertain' | 'no-go'; readonly reason: 'no-message' |
        'message-replaced' | 'answer-rewritten' | 'provider-finality-unverified' |
        'permission-or-document-changed' | 'cancelled' | 'qwen-unverified-live-dom' };

const KEY = /^[\w:.-]{1,256}$/;
const ID = /^[A-Za-z0-9_-]{4,128}$/;
const TURN = /^[A-Za-z0-9_-]{1,128}$/;
const requireLive = (input: G175Request) => {
  if (input.signal.aborted) throw new Error('G175 cancelled');
  if (input.consent.isStillApproved(input.provider, input.tabID) !== true)
    throw new Error('G175 permission revoked');
};
const budget = (value: number | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('G175 invalid polling budget');
  return value;
};
async function pause(ms: number, signal: AbortSignal) {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Explicit selected tab+message bound to G157/G160/G169 real CDP readers.
 * NEVER invokes G159 (send requires an independent human decision per action).
 * A successful bounded observation still ALWAYS ends uncertain, never finished. */
export async function* g175BrowserProgress(input: G175Request): AsyncGenerator<G175Event> {
  const polls = budget(input.polls, 12, 1, 32);
  const interval = budget(input.intervalMs, 200, 20, 2000);
  if (!input.signal || typeof input.consent?.allowAssistantText !== 'function' ||
      typeof input.consent?.isStillApproved !== 'function' ||
      input.consent.userDeclaresBrowserOwnership !== true ||
      !ID.test(input.tabID) || !TURN.test(input.turnID) || !KEY.test(input.messageKey) ||
      !['chatgpt', 'deepseek', 'gemini', 'mistral', 'qwen'].includes(input.provider))
    throw new Error('G175 explicit host ownership, exact tab, selected answer and revocation required');
  requireLive(input);
  const consent = {
    userDeclaresBrowserOwnership: true as const,
    approve: async (scope: 'read-only-headings', endpoint: string) => {
      requireLive(input);
      const result = await input.consent.approve(scope, endpoint);
      return result === true && !input.signal.aborted &&
        input.consent.isStillApproved(input.provider, input.tabID) === true;
    },
    allowAssistantText: async (tab: CdpTab) => {
      requireLive(input);
      if (tab.providerID !== input.provider || tab.tabID !== input.tabID) return false;
      const result = await input.consent.allowAssistantText(tab);
      return result === true && !input.signal.aborted &&
        input.consent.isStillApproved(input.provider, input.tabID) === true;
    },
  };
  const terminal = (status: 'uncertain' | 'no-go', reason:
    Extract<G175Event, { kind: 'terminal' }>['reason']) =>
    ({ kind: 'terminal' as const, turnID: input.turnID, provider: input.provider, status, reason });
  if (input.provider === 'qwen') {
    const observer = await G169QwenRead.attach(input.endpoint, input.tabID, {
      ...consent, signal: input.signal,
      isStillApproved: (tab) => tab.tabID === input.tabID &&
        tab.providerID === 'qwen' && !input.signal.aborted &&
        input.consent.isStillApproved('qwen', input.tabID),
    });
    try {
      const proof = await observer.probe(); // Actual G169 target/generation/epoch check.
      requireLive(input);
      if (proof.readStatus !== 'NO_GO_UNVERIFIED_LIVE_QWEN_DOM')
        throw new Error('G175 unexpected Qwen readiness');
      yield terminal('no-go', 'qwen-unverified-live-dom');
    } finally { await observer.close(); }
    return;
  }
  const observer = input.provider === 'chatgpt'
    ? await G157ChatgptCdpObserver.attach(input.endpoint, input.tabID, consent)
    : await G160OtherProviderObserver.attach(input.endpoint, input.tabID, input.provider, consent);
  try {
    let previous = '', seq = 0, found = false;
    for (let i = 0; i < polls; i++) {
      if (input.signal.aborted) { yield terminal('uncertain', 'cancelled'); return; }
      if (input.consent.isStillApproved(input.provider, input.tabID) !== true) {
        yield terminal('uncertain', 'permission-or-document-changed'); return;
      }
      let snapshot;
      try { snapshot = await observer.sample(); }
      catch {
        yield terminal('uncertain', input.signal.aborted ? 'cancelled' : 'permission-or-document-changed');
        return;
      }
      if (input.signal.aborted) { yield terminal('uncertain', 'cancelled'); return; }
      if (input.consent.isStillApproved(input.provider, input.tabID) !== true) {
        yield terminal('uncertain', 'permission-or-document-changed'); return;
      }
      if (snapshot && snapshot.messageKey !== input.messageKey || found && !snapshot) {
        yield terminal('uncertain', 'message-replaced'); return;
      }
      if (snapshot) {
        if (!snapshot.text.startsWith(previous)) {
          yield terminal('uncertain', 'answer-rewritten'); return;
        }
        const remaining = snapshot.text.slice(previous.length);
        for (let offset = 0; offset < remaining.length; offset += 4096) {
          if (input.signal.aborted || !input.consent.isStillApproved(input.provider, input.tabID)) {
            yield terminal('uncertain', input.signal.aborted ? 'cancelled' : 'permission-or-document-changed'); return;
          }
          yield { kind: 'candidate', turnID: input.turnID, provider: input.provider,
            tabID: input.tabID, messageKey: input.messageKey, seq: ++seq,
            text: remaining.slice(offset, offset + 4096), correlation: 'unverified-dom' };
        }
        previous = snapshot.text;
        found = true;
      }
      if (i + 1 < polls) await pause(interval, input.signal);
    }
    yield terminal('uncertain', found ? 'provider-finality-unverified' : 'no-message');
  } finally { await observer.close(); }
}
