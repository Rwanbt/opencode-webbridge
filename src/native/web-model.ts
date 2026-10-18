/** Native LanguageModelV3 for WebBridge: real browser observations only.
 *
 * Honest terminals: `complete` -> stop with an explicit raw marker; anything not
 * proven -> `error` finish reason with an explicit raw marker (the session layer
 * has no first-class UNCERTAIN state; see docs/proposals/plugin-provided-language-model.fr.md).
 * Auxiliary core calls (thread title) are answered locally and never reach a browser. */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from "@ai-sdk/provider";
import { isTitleGeneration, lastUserText, localTitle } from "./prompt.js";
import {
  WebBridgeSessionStateError,
  type NativeTerminalState,
  type NativeTurnRequest,
  type NativeTurnTransport,
} from "./turn-transport.js";

export const DOM_COMPLETE_RAW = "webbridge-dom-completion-observed";
export const TERMINAL_UNCERTAIN_RAW = "webbridge-terminal-uncertain";
export const TERMINAL_CANCELLED_RAW = "webbridge-turn-cancelled";
export const AUX_TITLE_RAW = "webbridge-aux-title-local";

const TEXT_ID = "webbridge-text";

/** Token counts are genuinely unknown for a DOM turn; never invented. */
const UNKNOWN_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

export interface WebModelOptions {
  readonly providerID: string;
  readonly modelID: string;
  readonly providerName: string;
  readonly origin: string;
  /** null = no attached, explicitly authorized browser session. */
  readonly transport: NativeTurnTransport | null;
  readonly fixture: boolean;
}

const terminalReason = (state: NativeTerminalState): LanguageModelV3FinishReason => {
  if (state === "complete") return { unified: "stop", raw: DOM_COMPLETE_RAW };
  if (state === "cancelled") return { unified: "error", raw: TERMINAL_CANCELLED_RAW };
  return { unified: "error", raw: TERMINAL_UNCERTAIN_RAW };
};

const UNCERTAIN_END: LanguageModelV3FinishReason = { unified: "error", raw: TERMINAL_UNCERTAIN_RAW };

export function createWebLanguageModel(options: WebModelOptions): LanguageModelV3 {
  const { providerID, modelID, providerName, origin, transport, fixture } = options;

  function metadata(terminal: string, reason: string): SharedV3ProviderMetadata {
    return { webbridge: { terminal, reason, correlation: "unverified-dom", origin, fixture } };
  }

  function refusal(detail: string): never {
    throw new WebBridgeSessionStateError(
      providerName,
      `${detail}; refusing to fabricate a provider answer (${origin})`,
    );
  }

  const request = (call: LanguageModelV3CallOptions): NativeTurnRequest => ({
    providerID,
    modelID,
    prompt: lastUserText(call.prompt),
    signal: call.abortSignal ?? new AbortController().signal,
  });

  return {
    specificationVersion: "v3",
    provider: providerID,
    modelId: modelID,
    supportedUrls: {},

    async doGenerate(call: LanguageModelV3CallOptions) {
      if (isTitleGeneration(call.prompt)) {
        const title = localTitle(call.prompt);
        return {
          content: [{ type: "text" as const, text: title }],
          finishReason: { unified: "stop" as const, raw: AUX_TITLE_RAW },
          usage: UNKNOWN_USAGE,
          warnings: [],
          providerMetadata: metadata("auxiliary", "local-title"),
        };
      }
      if (!transport) refusal("no attached authorized browser session");
      const session = transport;
      let text = "";
      for await (const event of session.stream(request(call))) {
        if (event.kind === "fragment") text += event.text;
        else {
          return {
            content: text ? [{ type: "text" as const, text }] : [],
            finishReason: terminalReason(event.state),
            usage: UNKNOWN_USAGE,
            warnings: [],
            providerMetadata: metadata(event.state, event.reason),
          };
        }
      }
      return {
        content: text ? [{ type: "text" as const, text }] : [],
        finishReason: UNCERTAIN_END,
        usage: UNKNOWN_USAGE,
        warnings: [],
        providerMetadata: metadata("uncertain", "transport-ended-without-terminal"),
      };
    },

    async doStream(call: LanguageModelV3CallOptions) {
      if (isTitleGeneration(call.prompt)) {
        const title = localTitle(call.prompt);
        const aux = new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            controller.enqueue({ type: "text-start", id: TEXT_ID });
            controller.enqueue({ type: "text-delta", id: TEXT_ID, delta: title });
            controller.enqueue({ type: "text-end", id: TEXT_ID });
            controller.enqueue({
              type: "finish", usage: UNKNOWN_USAGE,
              finishReason: { unified: "stop", raw: AUX_TITLE_RAW },
              providerMetadata: metadata("auxiliary", "local-title"),
            });
            controller.close();
          },
        });
        return { stream: aux };
      }
      if (!transport) refusal("no attached authorized browser session");
      const session = transport;
      const turn = request(call);
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          let opened = false;
          const closeText = () => {
            if (!opened) return;
            opened = false;
            controller.enqueue({ type: "text-end", id: TEXT_ID });
          };
          try {
            for await (const event of session.stream(turn)) {
              if (event.kind === "fragment") {
                if (!event.text) continue;
                if (!opened) {
                  opened = true;
                  controller.enqueue({ type: "text-start", id: TEXT_ID });
                }
                controller.enqueue({ type: "text-delta", id: TEXT_ID, delta: event.text });
                continue;
              }
              closeText();
              controller.enqueue({
                type: "finish", usage: UNKNOWN_USAGE,
                finishReason: terminalReason(event.state),
                providerMetadata: metadata(event.state, event.reason),
              });
              controller.close();
              return;
            }
            closeText();
            controller.enqueue({
              type: "finish", usage: UNKNOWN_USAGE, finishReason: UNCERTAIN_END,
              providerMetadata: metadata("uncertain", "transport-ended-without-terminal"),
            });
            controller.close();
          } catch (error) {
            controller.enqueue({ type: "error", error });
            controller.close();
          }
        },
      });
      return { stream };
    },
  };
}
