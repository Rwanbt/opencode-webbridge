/** The G159/G174 + G157/G160 CDP primitives behind the consented transport.
 *
 *  Imported LAZILY by the transport (these modules statically import playwright):
 *  the dormant plugin never loads the browser stack. The primitives are reused
 *  exactly as reviewed in the earlier waves: G157/G160 own attach/observe on the
 *  explicitly declared tab, G159/G174 own the single audited UI submission
 *  (durable one-shot consume before any UI effect, draft left untouched, no
 *  retry after a click).
 *
 *  Terminal honesty: no provider-final signal is proven for any provider DOM, so
 *  every attachment exposes NO completion proof. A turn therefore ends
 *  `uncertain` (finish reason `error` + explicit marker), never a false
 *  completion.
 */
import { G157ChatgptCdpObserver } from "../browser/g157-chatgpt-cdp-observer.js";
import { g159SendChatgptOnce } from "../providers/g159-chatgpt-approved-send.js";
import { G160OtherProviderObserver } from "../providers/g160-other-provider-dom.js";
import { g174SendDeepseekOnce } from "../providers/g174-deepseek-approved-send.js";
import { g175SendGeminiOnce } from "../providers/g175-gemini-approved-send.js";
import { g176SendQwenOnce } from "../providers/g176-qwen-approved-send.js";
import { g177SendMistralOnce } from "../providers/g177-mistral-approved-send.js";
import { sendPrimitiveOf } from "../providers/provider-adapters.js";
import {
  BrowserTurnRefusedError,
  BrowserTurnUncertainError,
  type BrowserTurnAttachment,
  type BrowserTurnObservation,
} from "./browser-turn-transport.js";
import { nativeTabConsent, type DeclaredTabConsent, type DeclaredTabTarget } from "./consented-transport.js";
import { WebBridgeSessionStateError } from "./turn-transport.js";

/** The language hook has no session id (documented limit): a stable local label. */
const SESSION_LABEL = "webbridge-native";

export interface DeclaredTabAttachmentInput {
  readonly provider: DeclaredTabTarget;
  readonly consent: DeclaredTabConsent;
  readonly env: NodeJS.ProcessEnv;
}

/** Shared per-provider wiring: consent re-read, read-only inventory, re-bind. */
function driverFor(input: DeclaredTabAttachmentInput) {
  const { provider, consent, env } = input;
  const stillDeclared = (): true => {
    const current = nativeTabConsent(env, provider);
    if (!current || current.endpoint !== consent.endpoint || current.tabID !== consent.tabID ||
        current.journalDir !== consent.journalDir)
      throw new Error("WebBridge native consent withdrawn: the declared tab configuration changed");
    return true;
  };
  const consent2 = {
    userDeclaresBrowserOwnership: true as const,
    approve: async () => stillDeclared(),
    allowAssistantText: async () => stillDeclared(),
  };
  const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
  // Read-only CDP inventory: the declared tab's current URL. Used only to detect
  // the same-origin navigation our own send causes.
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
  /** A successful click may navigate the new-chat document to the conversation
   *  it created: same declared tab and origin, new URL + generation. */
  const waitSameOriginNavigation = async (beforeUrl: string | null):
    Promise<'navigated' | 'unchanged' | 'origin-changed'> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await sleep(250);
      const nowUrl = await tabUrl().catch(() => null);
      if (!nowUrl || nowUrl === beforeUrl) continue;
      let same = false;
      try { same = new URL(nowUrl).origin === provider.origin; } catch { same = false; }
      return same ? 'navigated' : 'origin-changed';
    }
    return 'unchanged';
  };
  const rebind = async <T>(close: () => Promise<void>, attach: () => Promise<T>): Promise<T | null> => {
    await close().catch(() => {});
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      try { return await attach(); } catch { await sleep(250); }
    }
    return null;
  };
  return { provider, consent, stillDeclared, consent2, sleep, tabUrl,
    waitSameOriginNavigation, rebind };
}

export async function attachDeclaredChatgptTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent } = input;
  if (provider.id !== "chatgpt")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  const d = driverFor(input);
  const attach = () => G157ChatgptCdpObserver.attach(consent.endpoint, consent.tabID, d.consent2);
  let observer: G157ChatgptCdpObserver;
  try {
    observer = await attach();
  } catch {
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null ? null : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      d.stillDeclared();
      const beforeUrl = await d.tabUrl().catch(() => null);
      try {
        await g159SendChatgptOnce({
          endpoint: consent.endpoint, tabID: consent.tabID, sessionID: SESSION_LABEL, turnID, prompt,
          journalDir: consent.journalDir,
          consent: { ...d.consent2, approveSend: async () => d.stillDeclared(),
            isStillApproved: () => d.stillDeclared() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/G159_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message);
      }
      const outcome = await d.waitSameOriginNavigation(beforeUrl);
      if (outcome === 'navigated') {
        const next = await d.rebind<G157ChatgptCdpObserver>(() => observer.close(), attach);
        if (next) observer = next;
      }
    },
    sample: read,
    async close(): Promise<void> { await observer.close(); },
  });
}

export async function attachDeclaredDeepseekTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent } = input;
  if (provider.id !== "deepseek")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  const d = driverFor(input);
  const attach = () => G160OtherProviderObserver.attach(consent.endpoint, consent.tabID, 'deepseek', d.consent2);
  let observer: G160OtherProviderObserver;
  try {
    observer = await attach();
  } catch {
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null ? null : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      d.stillDeclared();
      const beforeUrl = await d.tabUrl().catch(() => null);
      try {
        await g174SendDeepseekOnce({
          endpoint: consent.endpoint, tabID: consent.tabID, sessionID: SESSION_LABEL, turnID, prompt,
          journalDir: consent.journalDir,
          consent: { ...d.consent2, approveSend: async () => d.stillDeclared(),
            isStillApproved: () => d.stillDeclared() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/G174_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message);
      }
      const outcome = await d.waitSameOriginNavigation(beforeUrl);
      if (outcome === 'navigated') {
        const next = await d.rebind<G160OtherProviderObserver>(() => observer.close(), attach);
        if (next) observer = next;
      }
    },
    sample: read,
    async close(): Promise<void> { await observer.close(); },
  });
}

export async function attachDeclaredGeminiTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent } = input;
  if (provider.id !== "gemini")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  const d = driverFor(input);
  const attach = () => G160OtherProviderObserver.attach(consent.endpoint, consent.tabID, 'gemini', d.consent2);
  let observer: G160OtherProviderObserver;
  try {
    observer = await attach();
  } catch {
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null ? null : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      d.stillDeclared();
      const beforeUrl = await d.tabUrl().catch(() => null);
      try {
        await g175SendGeminiOnce({
          endpoint: consent.endpoint, tabID: consent.tabID, sessionID: SESSION_LABEL, turnID, prompt,
          journalDir: consent.journalDir,
          consent: { ...d.consent2, approveSend: async () => d.stillDeclared(),
            isStillApproved: () => d.stillDeclared() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/G175_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message);
      }
      const outcome = await d.waitSameOriginNavigation(beforeUrl);
      if (outcome === 'navigated') {
        const next = await d.rebind<G160OtherProviderObserver>(() => observer.close(), attach);
        if (next) observer = next;
      }
    },
    sample: read,
    async close(): Promise<void> { await observer.close(); },
  });
}

export async function attachDeclaredQwenTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent } = input;
  if (provider.id !== "qwen")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  const d = driverFor(input);
  const attach = () => G160OtherProviderObserver.attach(consent.endpoint, consent.tabID, 'qwen', d.consent2);
  let observer: G160OtherProviderObserver;
  try {
    observer = await attach();
  } catch {
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null ? null : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      d.stillDeclared();
      const beforeUrl = await d.tabUrl().catch(() => null);
      try {
        await g176SendQwenOnce({
          endpoint: consent.endpoint, tabID: consent.tabID, sessionID: SESSION_LABEL, turnID, prompt,
          journalDir: consent.journalDir,
          consent: { ...d.consent2, approveSend: async () => d.stillDeclared(),
            isStillApproved: () => d.stillDeclared() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/G176_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message);
      }
      const outcome = await d.waitSameOriginNavigation(beforeUrl);
      if (outcome === 'navigated') {
        const next = await d.rebind<G160OtherProviderObserver>(() => observer.close(), attach);
        if (next) observer = next;
      }
    },
    sample: read,
    async close(): Promise<void> { await observer.close(); },
  });
}

export async function attachDeclaredMistralTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  const { provider, consent } = input;
  if (provider.id !== "mistral")
    throw new WebBridgeSessionStateError(provider.label, "no consented send primitive for this provider");
  const d = driverFor(input);
  const attach = () => G160OtherProviderObserver.attach(consent.endpoint, consent.tabID, 'mistral', d.consent2);
  let observer: G160OtherProviderObserver;
  try {
    observer = await attach();
  } catch {
    throw new WebBridgeSessionStateError(provider.label,
      "no attached authorized browser session; the declared local debug endpoint is unreachable, "
      + `the selected tab is gone, or it does not match ${provider.origin}`);
  }
  const read = async (): Promise<BrowserTurnObservation | null> => {
    const sample = await observer.sample();
    return sample === null ? null : Object.freeze({ messageKey: sample.messageKey, text: sample.text });
  };
  return Object.freeze({
    identity: observer.scope,
    baseline: await read(),
    async send(prompt: string, turnID: string): Promise<void> {
      d.stillDeclared();
      const beforeUrl = await d.tabUrl().catch(() => null);
      try {
        await g177SendMistralOnce({
          endpoint: consent.endpoint, tabID: consent.tabID, sessionID: SESSION_LABEL, turnID, prompt,
          journalDir: consent.journalDir,
          consent: { ...d.consent2, approveSend: async () => d.stillDeclared(),
            isStillApproved: () => d.stillDeclared() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/G177_SEND_UNCERTAIN/.test(message)) throw new BrowserTurnUncertainError(message);
        throw new BrowserTurnRefusedError(message);
      }
      const outcome = await d.waitSameOriginNavigation(beforeUrl);
      if (outcome === 'navigated') {
        const next = await d.rebind<G160OtherProviderObserver>(() => observer.close(), attach);
        if (next) observer = next;
      }
    },
    sample: read,
    async close(): Promise<void> { await observer.close(); },
  });
}

/** Dispatch on the declared provider; every other provider stays unsent. */
export async function attachDeclaredTab(
  input: DeclaredTabAttachmentInput,
): Promise<BrowserTurnAttachment> {
  if (sendPrimitiveOf(input.provider.id) === null)
    throw new WebBridgeSessionStateError(input.provider.label,
      '"' + input.provider.id + '" has no consented send primitive yet '
      + "(the adapter registry declares none; never inventing one)");
  if (input.provider.id === "chatgpt") return attachDeclaredChatgptTab(input);
  if (input.provider.id === "deepseek") return attachDeclaredDeepseekTab(input);
  if (input.provider.id === "gemini") return attachDeclaredGeminiTab(input);
  if (input.provider.id === "qwen") return attachDeclaredQwenTab(input);
  if (input.provider.id === "mistral") return attachDeclaredMistralTab(input);
  throw new WebBridgeSessionStateError(input.provider.label,
    "no consented attachment is wired for this provider yet");
}
