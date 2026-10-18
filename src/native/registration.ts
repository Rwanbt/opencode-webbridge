/** Native WebBridge providers/models in the official OpenCode selector.
 *
 * Public SDK only: `ctx.provider.transform` registers the provider/model and a
 * scoped `ctx.aisdk.hook('language')` supplies the real LanguageModelV3
 * in-process (the anchor module in the tarball only satisfies the core loader).
 * Activation is individual (`WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt,...`) and
 * dormant by default; no model is ever a fixture or a simulated answer. */
import { Model, Plugin, Provider } from "@opencode/plugin";
import { WEB_PROVIDER_CATALOG, type WebProviderID } from "../catalog.js";
import { fixtureTransport } from "./fixture-transport.js";
import type { NativeTurnTransport } from "./turn-transport.js";
import { createWebLanguageModel } from "./web-model.js";

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
  return { providers, fixture: env.WEBBRIDGE_NATIVE_MODEL_FIXTURE === "1" };
}

/** No consented browser transport is wired in this increment: the models remain
 * selectable and refuse with an explicit state instead of simulating an answer.
 * The consented CDP send/read transport is the next increment. */
function productionTransport(): NativeTurnTransport | null {
  return null;
}

export async function registerNativeWebModels(
  ctx: Plugin.Context,
  env: NodeJS.ProcessEnv,
): Promise<(() => Promise<void>) | undefined> {
  const config = nativeWebModelConfig(env);
  if (!config) return undefined;
  const transport = config.fixture ? fixtureTransport(env) : productionTransport();
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
          capabilities: { tools: false, input: ["text"], output: ["text"] },
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
        transport,
        fixture: config.fixture,
      });
    },
    { providerID: provider.providerID },
  )));
  return async () => {
    for (const hook of hooks) await hook.dispose();
    await registration.dispose();
  };
}
