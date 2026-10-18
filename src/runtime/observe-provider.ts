/** Read-only provider observation for the manual observe operator: one bounded,
 *  consent-gated discovery of the latest assistant message, then the shared G175
 *  progressive reader on the EXACT confirmed message. This module NEVER sends
 *  anything and never claims finality; the Qwen adapter terminates NO-GO by
 *  design (NO_GO_UNVERIFIED_LIVE_QWEN_DOM). The playwright-backed primitives are
 *  imported LAZILY per adapter so tests and dormant loads never pay for the
 *  browser stack, and every read re-checks the host-owned revocation flag. */
import type { CdpProviderID, CdpTab } from "../browser/explicit-cdp-read.js";
import { requireProviderAdapter, type ProviderAdapter } from "../providers/provider-adapters.js";

const TAB_ID = /^[A-Za-z0-9_-]{4,128}$/;
const TURN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MESSAGE_KEY = /^[\w:.-]{1,256}$/;
const PROVIDER = /^[a-z][a-z0-9-]{1,20}$/;
const ARG_FIELDS = ["provider", "endpoint", "tab", "turn", "message", "polls"] as readonly string[];
const fail: (why: string) => never = (why) => { throw new Error("WebBridge observe refusal: " + why); };
const parseUrl = (raw: string): URL => {
  try { return new URL(raw); }
  catch { return fail("bad CDP endpoint"); }
};

export interface ObserveInvocation {
  readonly provider: string;
  /** Strict loopback CDP endpoint, e.g. http://127.0.0.1:9222. */
  readonly endpoint: string;
  readonly tabID: string;
  /** Opaque label for emitted events; never derived from the page. */
  readonly turnID: string;
  /** Present only after the operator confirmed the exact discovered message. */
  readonly messageKey?: string;
  readonly polls?: number;
}

/** Strict operator invocation: unknown or duplicate arguments and anything but a
 *  bare loopback CDP endpoint refuse loudly (never defaulted). Provider
 *  admission stays authoritative in the registry (requireProviderAdapter). */
export function parseObserveInvocation(args: readonly string[]): ObserveInvocation {
  const data: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i] ?? "";
    const name = key.startsWith("--") ? key.slice(2) : "";
    if (!ARG_FIELDS.includes(name) || Object.hasOwn(data, name) || i + 1 >= args.length)
      fail("unknown or duplicate argument");
    data[name] = args[++i] ?? "";
  }
  if (["provider", "endpoint", "tab", "turn"].some((key) => !data[key]))
    fail("required arguments missing (--provider --endpoint --tab --turn)");
  if (!PROVIDER.test(data.provider)) fail("invalid provider id");
  if (!TAB_ID.test(data.tab) || !TURN_ID.test(data.turn)) fail("invalid opaque identifier");
  if (data.message !== undefined && !MESSAGE_KEY.test(data.message)) fail("invalid selected message key");
  let polls: number | undefined;
  if (data.polls !== undefined) {
    if (!/^\d{1,2}$/.test(data.polls) || Number(data.polls) < 1 || Number(data.polls) > 32)
      fail("polls must be an integer within 1..32");
    polls = Number(data.polls);
  }
  const endpoint = parseUrl(data.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" ||
      !/^\d+$/.test(endpoint.port) || endpoint.port === "0" || endpoint.pathname !== "/" ||
      endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
    fail("local CDP endpoint required (http://127.0.0.1:<port>)");
  return Object.freeze({
    provider: data.provider, endpoint: endpoint.origin, tabID: data.tab, turnID: data.turn,
    ...(data.message !== undefined ? { messageKey: data.message } : {}),
    ...(polls !== undefined ? { polls } : {}),
  });
}

export interface ObserveConsent {
  readonly userDeclaresBrowserOwnership: true;
  readonly approve: (scope: "read-only-headings", endpoint: string) => Promise<boolean>;
  readonly allowAssistantText: (tab: CdpTab) => Promise<boolean>;
  /** Host-owned synchronous revocation flag; re-read before every read. */
  readonly isStillApproved: (provider: string, tabID: string) => boolean;
}

export interface ObserveRequest {
  readonly provider: string;
  readonly endpoint: string;
  readonly tabID: string;
  readonly turnID: string;
  /** Present only after the operator confirmed the exact discovered message. */
  readonly messageKey?: string;
  readonly consent: ObserveConsent;
  readonly signal: AbortSignal;
  readonly polls?: number;
  readonly intervalMs?: number;
}

export interface DiscoveredMessage {
  readonly messageKey: string;
  readonly text: string;
  readonly preview: string;
}

export type ObserveEvent =
  | { readonly kind: "candidate"; readonly seq: number; readonly text: string }
  | { readonly kind: "terminal"; readonly status: "uncertain" | "no-go"; readonly reason: string };

interface CheckedObserveRequest {
  readonly adapter: ProviderAdapter;
  readonly endpoint: string;
  readonly tabID: string;
  readonly turnID: string;
  readonly messageKey: string | undefined;
  readonly consent: ObserveConsent;
  readonly signal: AbortSignal;
}

const requireLoopback = (raw: string): string => {
  const url = parseUrl(raw);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !/^\d+$/.test(url.port) || url.port === "0" || url.pathname !== "/" ||
      url.search || url.hash || url.username || url.password)
    fail("local CDP endpoint required (http://127.0.0.1:<port>)");
  return url.origin;
};

function check(input: ObserveRequest): CheckedObserveRequest {
  const adapter = requireProviderAdapter(input.provider);
  if (!input.signal || typeof input.signal.aborted !== "boolean") fail("an AbortSignal is required");
  if (input.consent?.userDeclaresBrowserOwnership !== true ||
      typeof input.consent?.approve !== "function" ||
      typeof input.consent?.allowAssistantText !== "function" ||
      typeof input.consent?.isStillApproved !== "function")
    fail("explicit host ownership, per-read approval and revocation checks are required");
  if (!TAB_ID.test(input.tabID)) fail("an explicit CDP tab id is required");
  if (!TURN_ID.test(input.turnID)) fail("an opaque turn id is required");
  if (input.messageKey !== undefined && !MESSAGE_KEY.test(input.messageKey))
    fail("a selected message key is malformed");
  return Object.freeze({
    adapter, endpoint: requireLoopback(input.endpoint), tabID: input.tabID, turnID: input.turnID,
    messageKey: input.messageKey, consent: input.consent, signal: input.signal,
  });
}

const requireLive = (checked: CheckedObserveRequest): void => {
  if (checked.signal.aborted) fail("cancelled before any browser contact");
  if (!checked.consent.isStillApproved(checked.adapter.id, checked.tabID))
    fail("read approval was revoked before any browser contact");
};

/** Host-owned consent envelope: every read re-checks revocation and tab identity. */
const gateConsent = (checked: CheckedObserveRequest) => ({
  userDeclaresBrowserOwnership: true as const,
  approve: async (scope: "read-only-headings", endpoint: string) => {
    requireLive(checked);
    const result = await checked.consent.approve(scope, endpoint);
    return result === true && !checked.signal.aborted &&
      checked.consent.isStillApproved(checked.adapter.id, checked.tabID) === true;
  },
  allowAssistantText: async (tab: CdpTab) => {
    if (checked.signal.aborted) return false;
    if (tab.providerID !== checked.adapter.id || tab.tabID !== checked.tabID) return false;
    const result = await checked.consent.allowAssistantText(tab);
    return result === true && !checked.signal.aborted &&
      checked.consent.isStillApproved(checked.adapter.id, checked.tabID) === true;
  },
});

const observed = (messageKey: string, text: string): DiscoveredMessage => Object.freeze({
  messageKey, text,
  preview: text.length > 400 ? text.slice(0, 400) + "…" : text,
});

/** One consent-gated attach + sample of the latest assistant message, then a
 *  clean disconnect. Returns null when the selected tab exposes no message. */
export async function discoverProviderAssistant(input: ObserveRequest): Promise<DiscoveredMessage | null> {
  const checked = check(input);
  requireLive(checked);
  if (!checked.adapter.discoverable)
    fail('"' + checked.adapter.id + '" has no verified live DOM reader (' +
      checked.adapter.readPrimitive + '); discovery is impossible: ' + checked.adapter.notes);
  const consent = gateConsent(checked);
  if (checked.adapter.readPrimitive === "g157-chatgpt-cdp-observer") {
    const { G157ChatgptCdpObserver } = await import("../browser/g157-chatgpt-cdp-observer.js");
    const observer = await G157ChatgptCdpObserver.attach(checked.endpoint, checked.tabID, consent);
    try {
      const sample = await observer.sample();
      return sample ? observed(sample.messageKey, sample.text) : null;
    } finally { await observer.close(); }
  }
  const provider = checked.adapter.id;
  if (provider !== "deepseek" && provider !== "gemini" && provider !== "mistral")
    fail('"' + provider + '" has no discovery reader');
  const { G160OtherProviderObserver } = await import("../providers/g160-other-provider-dom.js");
  const observer = await G160OtherProviderObserver.attach(
    checked.endpoint, checked.tabID, provider, consent);
  try {
    const sample = await observer.sample();
    return sample ? observed(sample.messageKey, sample.text) : null;
  } finally { await observer.close(); }
}

/** Bounded progressive read on the exact confirmed message, or the explicit
 *  Qwen NO-GO readiness probe. Never sends, never returns "finished": the
 *  terminal is always UNCERTAIN (or the Qwen no-go), like the shared G175
 *  reader this delegates to. */
export async function* observeProviderAssistant(input: ObserveRequest): AsyncGenerator<ObserveEvent> {
  const checked = check(input);
  requireLive(checked);
  const provider: CdpProviderID = checked.adapter.id;
  if (checked.messageKey === undefined)
    fail("a confirmed assistant message key is required (discover the exact message, confirm it, then observe)");
  const { g175BrowserProgress } = await import("./g175-browser-progress.js");
  for await (const event of g175BrowserProgress({
    endpoint: checked.endpoint, tabID: checked.tabID, provider, turnID: checked.turnID,
    messageKey: checked.messageKey, consent: checked.consent, signal: checked.signal,
    ...(input.polls !== undefined ? { polls: input.polls } : {}),
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
  })) {
    if (event.kind === "candidate") yield { kind: "candidate", seq: event.seq, text: event.text };
    else yield { kind: "terminal", status: event.status, reason: event.reason };
  }
}
