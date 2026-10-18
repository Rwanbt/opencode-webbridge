/** The G159/G157 CDP primitives behind the consented transport.
 *
 * Imported LAZILY by the transport (this module statically imports playwright):
 * the dormant plugin never loads the browser stack. The primitives are reused
 * exactly as reviewed in the earlier waves: G157 owns attach/observe on the
 * explicitly declared ChatGPT tab, G159 owns the single audited UI submission
 * (durable one-shot consume before any UI effect, draft left untouched, no
 * retry after a click).
 *
 * Terminal honesty: no provider-final signal for the ChatGPT DOM is proven, so
 * this attachment deliberately exposes NO completion proof. The turn therefore
 * ends `uncertain` (finish reason `error` + explicit marker), never a false
 * completion.
 */
import { G157ChatgptCdpObserver } from "../browser/g157-chatgpt-cdp-observer.js";
import { g159SendChatgptOnce } from "../providers/g159-chatgpt-approved-send.js";
import {
  BrowserTurnRefusedError,
  BrowserTurnUncertainError,
  type BrowserTurnAttachment,
  type BrowserTurnObservation,
} from "./browser-turn-transport.js";
import { nativeTabConsent, type DeclaredTabConsent, type DeclaredTabTarget } from "./consented-transport.js";
import { WebBridgeSessionStateError } from "./turn-transport.js";

/** G159 action label: the language hook has no session id (documented limit). */
const SESSION_LABEL = "webbridge-native";

export interface DeclaredTabAttachmentInput {
  readonly provider: DeclaredTabTarget;
  readonly consent: DeclaredTabConsent;
  readonly env: NodeJS.ProcessEnv;
}

export async function attachDeclaredChatgptTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent, env } = input;
  if (provider.id !== "chatgpt")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  // Re-read the declaration at every consent point: a changed/removed tab
  // declaration revokes the session instead of lingering in memory.
  const stillDeclared = (): true => {
    const current = nativeTabConsent(env, provider);
    if (!current || current.endpoint !== consent.endpoint || current.tabID !== consent.tabID ||
        current.journalDir !== consent.journalDir)
      throw new Error("WebBridge native consent withdrawn: the declared tab configuration changed");
    return true;
  };
  const driverConsent = {
    userDeclaresBrowserOwnership: true as const,
    approve: async () => stillDeclared(),
    allowAssistantText: async () => stillDeclared(),
  };
  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  // Read-only CDP inventory: the declared tab's current URL. Used only to
  // detect the same-origin navigation our own send causes.
  const tabUrl = async (): Promise<string | null> => {
    const response = await fetch(consent.endpoint + '/json/list', {
      redirect: 'error', signal: AbortSignal.timeout(3000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const list = await response.json();
    const entry = Array.isArray(list) ? list.find((item) => item && item.id === consent.tabID) : null;
    return typeof entry?.url === 'string' ? entry.url : null;
  };
  let observer: G157ChatgptCdpObserver;
  try {
    observer = await G157ChatgptCdpObserver.attach(consent.endpoint, consent.tabID, driverConsent);
  } catch {
    // Never echo driver internals: the operator gets the actionable state, and
    // no turn was ever sent (attach precedes every UI effect).
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null
      ? null
      : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      stillDeclared();
      const beforeUrl = await tabUrl().catch(() => null);
      try {
        await g159SendChatgptOnce({
          endpoint: consent.endpoint,
          tabID: consent.tabID,
          sessionID: SESSION_LABEL,
          turnID,
          prompt,
          journalDir: consent.journalDir,
          consent: {
            ...driverConsent,
            approveSend: async () => stillDeclared(),
            isStillApproved: () => stillDeclared(),
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // G159 consumed the one-shot before its UI effect: the click may have
        // landed, so this attempt must never be replayed.
        if (/G159_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message); // no UI effect happened
      }
      // A successful click navigates the new-chat document to the conversation
      // it just created: same declared tab, same provider origin, new URL and
      // generation. Re-bind the READ-ONLY observer to that document. G157 still
      // enforces tab identity, origin and document epoch; if the re-bind fails
      // the turn stays uncertain (never a fabricated answer).
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        await sleep(250);
        const nowUrl = await tabUrl().catch(() => null);
        if (!nowUrl || nowUrl === beforeUrl) continue;
        let sameOrigin = false;
        try { sameOrigin = new URL(nowUrl).origin === provider.origin; } catch { sameOrigin = false; }
        if (!sameOrigin) return; // origin change is never adopted
        // Same-origin navigation to the conversation our click created: re-bind
        // the read-only observer to the new document (same declared tab).
        await observer.close().catch(() => {});
        const rebindDeadline = Date.now() + 8_000;
        while (Date.now() < rebindDeadline) {
          try {
            observer = await G157ChatgptCdpObserver.attach(consent.endpoint, consent.tabID, driverConsent);
            return;
          } catch { await sleep(250); }
        }
        return;
      }
      // No navigation (the tab was already inside a conversation): the
      // original observer is still bound to the same URL/generation and reads
      // the same document.
    },
    sample: read,
    // No `completion` proof exists for this provider: an unproven turn stays uncertain.
    async close(): Promise<void> {
      await observer.close();
    },
  });
}
