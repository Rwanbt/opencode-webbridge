/** Anchor module loaded by the OpenCode core loader for `package: 'aisdk:file://…'`.
 *
 * The core resolves the module and calls the first export whose name starts with
 * `create`; only then are the plugin's `aisdk` hooks reached. The plugin's
 * `language` hook replaces this model with the real WebBridge model. If that hook
 * is ever inactive, these stubs refuse every call instead of fabricating text.
 * This file must stay dependency-free: the core imports it outside the plugin. */
const NO_HOOK = "WebBridge native anchor: plugin language hook inactive; refusing to fabricate a response";

interface AnchorModel {
  readonly specificationVersion: "v3";
  readonly provider: string;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]>;
  doGenerate(): Promise<never>;
  doStream(): Promise<never>;
}

export function createWebBridgeNativeAnchor(): { languageModel: (modelID?: string) => AnchorModel } {
  const model = (modelID: string): AnchorModel => ({
    specificationVersion: "v3",
    provider: "webbridge-native-anchor",
    modelId: modelID,
    supportedUrls: {},
    async doGenerate(): Promise<never> { throw new Error(NO_HOOK); },
    async doStream(): Promise<never> { throw new Error(NO_HOOK); },
  });
  return { languageModel: (modelID?: string) => model(modelID ?? "unknown") };
}
