/** One reviewable adapter seam per provider: the EXISTING reviewed primitives and
 *  the precise capability that is still missing. Nothing here fabricates a
 *  selector, a send primitive or a completion proof; the registry exists so the
 *  native transport, the manual observers and future send wiring cannot drift
 *  apart, and so a capability can only move by an explicit reviewed change here.
 *
 *  Origins are single-sourced from ../catalog.js (never retyped). Read primitives
 *  name the pinned modules: src/browser/g157-chatgpt-cdp-observer.ts (chatgpt),
 *  src/providers/g160-other-provider-dom.ts (deepseek/gemini/mistral) and
 *  src/providers/g169-qwen-read.ts (qwen capability probe, NO-GO by design). */
import { WEB_PROVIDER_CATALOG, type WebProviderID } from "../catalog.js";

export type ProviderReadPrimitive =
  | "g157-chatgpt-cdp-observer"
  | "g160-other-provider-dom"
  | "g169-qwen-probe";
export type ProviderSendPrimitive = "g159-chatgpt-one-shot" | "g174-deepseek-one-shot";

export interface ProviderAdapter {
  readonly id: WebProviderID;
  readonly label: string;
  /** Exact approved site origin (single source: the shared provider catalog). */
  readonly origin: string;
  /** Reviewed read-only primitive allowed to observe this provider's tab. */
  readonly readPrimitive: ProviderReadPrimitive;
  /** True only when the read primitive can expose the latest assistant message.
   *  The Qwen capability probe is NO-GO by design and never reads the DOM. */
  readonly discoverable: boolean;
  /** Null = no verified send primitive exists: every inference turn for this
   *  provider refuses per turn (src/native/consented-transport.ts). */
  readonly sendPrimitive: ProviderSendPrimitive | null;
  /** No provider can PROVE DOM completion today; terminals stay uncertain. */
  readonly completionProof: "none";
  /** Precise, user-visible limitation for operators and diagnostics. */
  readonly notes: string;
}

const CAPABILITIES: Readonly<
  Record<WebProviderID, Omit<ProviderAdapter, "id" | "label" | "origin">>
> = {
  chatgpt: {
    readPrimitive: "g157-chatgpt-cdp-observer",
    discoverable: true,
    sendPrimitive: "g159-chatgpt-one-shot",
    completionProof: "none",
    notes: "consented one-shot send + read-only observer; response finality stays UNCERTAIN until live completion is proven",
  },
  deepseek: {
    readPrimitive: "g160-other-provider-dom",
    discoverable: true,
    sendPrimitive: "g174-deepseek-one-shot",
    completionProof: "none",
    notes: "consented one-shot send (composer + primary send control observed on the authenticated UI) + read-only observer; response finality stays UNCERTAIN",
  },
  gemini: {
    readPrimitive: "g160-other-provider-dom",
    discoverable: true,
    sendPrimitive: null,
    completionProof: "none",
    notes: "read-only observer with tentative selectors (unverified against the authenticated UI); no send primitive",
  },
  qwen: {
    readPrimitive: "g169-qwen-probe",
    discoverable: false,
    sendPrimitive: null,
    completionProof: "none",
    notes: "capability probe only: live Qwen DOM is NOT verified (NO_GO_UNVERIFIED_LIVE_QWEN_DOM); no read, no send",
  },
  mistral: {
    readPrimitive: "g160-other-provider-dom",
    discoverable: true,
    sendPrimitive: null,
    completionProof: "none",
    notes: "read-only observer with tentative selectors (unverified against the authenticated UI); no send primitive",
  },
};

/** Frozen registry covering exactly the shared catalog, one adapter per provider. */
export const PROVIDER_ADAPTERS: Readonly<Record<WebProviderID, ProviderAdapter>> = Object.freeze(
  Object.fromEntries(WEB_PROVIDER_CATALOG.map((provider) => [
    provider.id,
    Object.freeze({
      id: provider.id,
      label: provider.name,
      origin: provider.origin,
      ...CAPABILITIES[provider.id],
    }),
  ])) as Record<WebProviderID, ProviderAdapter>,
);

export const PROVIDER_ADAPTER_IDS: readonly WebProviderID[] = Object.freeze(
  WEB_PROVIDER_CATALOG.map((provider) => provider.id),
);

/** Loud refusal for an unknown id; never falls back to a default adapter. */
export function requireProviderAdapter(id: string): ProviderAdapter {
  const adapter: ProviderAdapter | undefined = PROVIDER_ADAPTERS[id as WebProviderID];
  if (!adapter) {
    throw new Error('WebBridge unknown provider adapter "' + id + '" (known adapters: '
      + PROVIDER_ADAPTER_IDS.join(", ") + ")");
  }
  return adapter;
}

/** Fail-closed send capability for a possibly-unknown id: null means the turn
 *  refuses; an unknown id never defaults to any capability. */
export function sendPrimitiveOf(id: string): ProviderSendPrimitive | null {
  return PROVIDER_ADAPTERS[id as WebProviderID]?.sendPrimitive ?? null;
}
