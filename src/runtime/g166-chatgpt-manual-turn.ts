/** G166: human-invoked CDP send + bounded read. DOM is never provider finality. */
import { G157ChatgptCdpObserver, type G157Consent } from '../browser/g157-chatgpt-cdp-observer.js';
import { g159SendChatgptOnce, type G159SendConsent, type G159SendRequest } from '../providers/g159-chatgpt-approved-send.js';

export type G166Consent = G157Consent & G159SendConsent;
export interface G166ManualTurn extends Omit<G159SendRequest, 'consent'> {
  /** Host/operator callbacks. Never populate these from model or page content. */
  readonly consent: G166Consent;
  readonly signal?: AbortSignal;
  readonly polls?: number;
  readonly intervalMs?: number;
}
export type G166TurnEvent =
  | { readonly kind: 'candidate'; readonly turnID: string; readonly messageKey: string;
      readonly seq: number; readonly text: string; readonly attribution: 'unverified' }
  | { readonly kind: 'terminal'; readonly turnID: string; readonly status: 'uncertain';
      readonly reason: 'send-uncertain' | 'cancelled' | 'read-revoked-or-document-changed' |
        'candidate-replaced-or-rewritten' | 'no-new-candidate' | 'provider-finality-unverified';
      readonly messageKey?: string };

const aborted = (signal?: AbortSignal) => signal?.aborted === true;
const cancelled = (signal?: AbortSignal) => {
  if (aborted(signal)) throw new Error('G166 manual turn cancelled');
};
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error('G166 invalid polling budget');
  return value;
};
async function pause(ms: number, signal?: AbortSignal) {
  if (aborted(signal)) return;
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/** Manual invocation only; never registers a model, tool or automatic retry.
 * Even a fresh visible assistant bubble is untrusted as an ACK for this prompt.
 * The persistent G157 observer detects same-URL reload across the G159 click. */
export async function* g166ChatgptManualTurn(input: G166ManualTurn): AsyncGenerator<G166TurnEvent> {
  const polls = bounded(input.polls, 12, 1, 32);
  const interval = bounded(input.intervalMs, 200, 20, 2000);
  cancelled(input.signal);
  const { consent, signal, turnID } = input;
  const guarded: G166Consent = {
    userDeclaresBrowserOwnership: consent.userDeclaresBrowserOwnership,
    approve: async (scope, endpoint) => {
      cancelled(signal);
      const allowed = await consent.approve(scope, endpoint);
      return allowed === true && !aborted(signal);
    },
    allowAssistantText: async (tab) => {
      cancelled(signal);
      const allowed = await consent.allowAssistantText(tab);
      return allowed === true && !aborted(signal);
    },
    approveSend: async (action, prompt) => {
      cancelled(signal);
      const allowed = await consent.approveSend(action, prompt);
      return allowed === true && !aborted(signal);
    },
    isStillApproved: (action) => !aborted(signal) && consent.isStillApproved(action),
  };
  const attachment = await G157ChatgptCdpObserver.attach(input.endpoint, input.tabID, guarded);
  try {
    // Capture last assistant bubble BEFORE sending; do not confuse it with our answer.
    const baseline = await attachment.sample();
    cancelled(signal);
    try {
      await g159SendChatgptOnce({ ...input, consent: guarded });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('G159_SEND_UNCERTAIN')) throw error;
      yield { kind: 'terminal', turnID, status: 'uncertain', reason: 'send-uncertain' };
      return;
    }
    let selected: string | undefined, previous = '', seq = 0;
    for (let attempt = 0; attempt < polls; attempt++) {
      if (aborted(signal)) {
        yield { kind: 'terminal', turnID, status: 'uncertain', reason: 'cancelled' };
        return;
      }
      let answer;
      try { answer = await attachment.sample(); }
      catch {
        yield { kind: 'terminal', turnID, status: 'uncertain', reason: 'read-revoked-or-document-changed' };
        return;
      }
      if (!answer && selected || (answer && selected && answer.messageKey !== selected) ||
          (answer && selected && !answer.text.startsWith(previous))) {
        yield { kind: 'terminal', turnID, status: 'uncertain', reason: 'candidate-replaced-or-rewritten' };
        return;
      }
      if (answer && answer.messageKey !== baseline?.messageKey) {
        if (!selected) selected = answer.messageKey;
        const pending = answer.text.slice(previous.length);
        // Prefix-append only; each fragment still has UNVERIFIED turn attribution.
        if (aborted(signal)) {
          yield { kind: 'terminal', turnID, status: 'uncertain', reason: 'cancelled' };
          return;
        }
        for (let offset = 0; offset < pending.length; offset += 4096) {
          yield { kind: 'candidate', turnID, messageKey: selected,
            seq: ++seq, text: pending.slice(offset, offset + 4096), attribution: 'unverified' };
        }
        previous = answer.text;
      }
      if (attempt + 1 < polls) await pause(interval, signal);
    }
    yield { kind: 'terminal', turnID, status: 'uncertain',
      reason: selected ? 'provider-finality-unverified' : 'no-new-candidate',
      ...(selected ? { messageKey: selected } : {}) };
  } finally { await attachment.close(); }
}
