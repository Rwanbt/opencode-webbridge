/** Native WebBridge providers/models in the official OpenCode selector.
 *
 * Public SDK only: `ctx.provider.transform` registers the provider/model and a
 * scoped `ctx.aisdk.hook('language')` supplies the real LanguageModelV3
 * in-process (the anchor module in the tarball only satisfies the core loader).
 * Activation is individual (`WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt,...`) and
 * dormant by default; the consented browser transport additionally requires an
 * explicitly declared loopback tab per provider (`WEBBRIDGE_NATIVE_TAB_<ID>`
 * plus a private `WEBBRIDGE_NATIVE_JOURNAL_DIR`). No model is ever a fixture or
 * a simulated answer. */
import { Model, Plugin, Provider } from "@opencode/plugin";
import { WEB_PROVIDER_CATALOG, type WebProviderID } from "../catalog.js";
import { consentedTransport } from "./consented-transport.js";
import { fixtureTransport } from "./fixture-transport.js";
import { governedNativeTransport } from "./governed-transport.js";
import type { NativeTurnTransport } from "./turn-transport.js";
import { createWebLanguageModel } from "./web-model.js";
import { toolBridgeEnabled } from "./tool-bridge.js";

export interface NativeWebProvider {
  readonly id: WebProviderID;
  readonly providerID: string;
  readonly modelID: string;
  readonly label: string;
  readonly origin: string;
  /** Per-provider tab selection; required before any send is possible. */
  readonly tabEnv: string;
}

/** Honest IDs: the registered "model" is the user's web session, not a claimed model version. */
export const NATIVE_WEB_PROVIDERS: readonly NativeWebProvider[] = WEB_PROVIDER_CATALOG.map((provider) => ({
  id: provider.id,
  providerID: `webbridge-${provider.id}`,
  modelID: `${provider.id}-web`,
  label: provider.name,
  origin: provider.origin,
  tabEnv: `WEBBRIDGE_NATIVE_TAB_${provider.id.toUpperCase()}`,
}));

export const NATIVE_MODELS_OPT = "WEBBRIDGE_NATIVE_WEB_MODELS";
export const ANCHOR_URL = new URL("./provider-anchor.js", import.meta.url).href;

export interface NativeWebModelConfig {
  readonly providers: readonly NativeWebProvider[];
  readonly fixture: boolean;
  /** Opt-in read-only tool bridge (text -> tool-call). */
  readonly toolBridge: boolean;
}

/** Individual activation list; unknown names fail loudly instead of being ignored. */
export function nativeWebModelConfig(env: NodeJS.ProcessEnv): NativeWebModelConfig | null {
  const requested = (env[NATIVE_MODELS_OPT] ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) return null;
  const providers: NativeWebProvider[] = [];
  for (const value of requested) {
    const provider = NATIVE_WEB_PROVIDERS.find((candidate) => candidate.id === value);
    if (!provider) {
      const known = NATIVE_WEB_PROVIDERS.map((candidate) => candidate.id).join(",");
      throw new Error(`WebBridge native models: unknown provider "${value}" (expected ${known})`);
    }
    providers.push(provider);
  }
  return { providers, fixture: env.WEBBRIDGE_NATIVE_MODEL_FIXTURE === "1",
    toolBridge: toolBridgeEnabled(env) };
}

export async function registerNativeWebModels(
  ctx: Plugin.Context,
  env: NodeJS.ProcessEnv,
): Promise<(() => Promise<void>) | undefined> {
  const config = nativeWebModelConfig(env);
  if (!config) return undefined;
  // One transport per activated provider: a declared loopback tab
  // (`WEBBRIDGE_NATIVE_TAB_<PROVIDER>`) enables the consented browser transport,
  // otherwise the model stays selectable and refuses with an explicit state.
  const fixture = config.fixture ? fixtureTransport(env) : null;
  const transports = new Map<WebProviderID, NativeTurnTransport | null>();
  for (const provider of config.providers) {
    // The fixture transport is the test harness and stays ungoverned; a real
    // consented transport is always wrapped so a runaway model cannot hammer a
    // browser and no refusal message can leak a secret.
    if (fixture) { transports.set(provider.id, fixture); continue; }
    const consented = await consentedTransport(env, provider);
    transports.set(provider.id, consented === null ? null : governedNativeTransport(consented));
  }
  const registration = await ctx.provider.transform((editor) => {
    for (const provider of config.providers) {
      const providerID = Provider.ID.make(provider.providerID);
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: `WebBridge ${provider.label} Web (personal browser session, no API key)`,
          activation: "enabled",
          package: `aisdk:${ANCHOR_URL}`,
          settings: {},
        },
        models: [{
          ...Model.Info.default(providerID, Model.ID.make(provider.modelID)),
          name: `${provider.label} Web (browser session; observed terminal, non-authoritative)`,
          // "tools" is advertised only when the bridge is on: without it the
          // model is text-only and must not pretend it can call anything.
          capabilities: { tools: config.toolBridge, input: ["text"], output: ["text"] },
        }],
      });
    }
  });
  const hooks = await Promise.all(config.providers.map((provider) => ctx.aisdk.hook(
    "language",
    (input) => {
      if (input.model?.providerID !== provider.providerID) return;
      input.language = createWebLanguageModel({
        providerID: provider.providerID,
        modelID: provider.modelID,
        providerName: provider.label,
        origin: provider.origin,
        transport: transports.get(provider.id) ?? null,
        fixture: config.fixture,
        toolBridge: config.toolBridge,
      });
    },
    { providerID: provider.providerID },
  )));
  return async () => {
    for (const hook of hooks) await hook.dispose();
    await registration.dispose();
  };
}
