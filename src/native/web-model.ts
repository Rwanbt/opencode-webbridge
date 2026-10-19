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
import { browserPrompt, isTitleGeneration, lastUserText, localTitle } from "./prompt.js";
import { firstFenceIndex, holdBack, parseToolCalls, toolContract } from "./tool-bridge.js";
import {
  WebBridgeSessionStateError,
  type NativeTerminalState,
  type NativeTurnRequest,
  type NativeTurnTransport,
} from "./turn-transport.js";

export const DOM_COMPLETE_RAW = "webbridge-dom-completion-observed";
export const TERMINAL_UNCERTAIN_RAW = "webbridge-terminal-uncertain";
export const TERMINAL_CANCELLED_RAW = "webbridge-turn-cancelled";
export const TOOL_CALLS_RAW = "webbridge-tool-calls-from-browser-text";
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
  /** Opt-in: let the browser model drive the READ-ONLY tools through text. */
  readonly toolBridge: boolean;
}

const terminalReason = (state: NativeTerminalState): LanguageModelV3FinishReason => {
  if (state === "complete") return { unified: "stop", raw: DOM_COMPLETE_RAW };
  if (state === "cancelled") return { unified: "error", raw: TERMINAL_CANCELLED_RAW };
  return { unified: "error", raw: TERMINAL_UNCERTAIN_RAW };
};

const UNCERTAIN_END: LanguageModelV3FinishReason = { unified: "error", raw: TERMINAL_UNCERTAIN_RAW };

export function createWebLanguageModel(options: WebModelOptions): LanguageModelV3 {
  const { providerID, modelID, providerName, origin, transport, fixture, toolBridge } = options;

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
    // The browser sees the tool contract and any tool result OpenCode produced;
    // without the bridge this is exactly the previous last-user-text behaviour.
    prompt: browserPrompt(call.prompt, toolBridge ? toolContract() : null),
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
      const finish = (state: NativeTerminalState, reason: string) => {
        // Same rule as the stream: a tool call runs only on a proven complete turn.
        if (toolBridge && state === "complete") {
          const at = firstFenceIndex(text);
          if (at >= 0) {
            const parsed = parseToolCalls(text.slice(at));
            if (parsed.calls.length) {
              const prose = text.slice(0, at);
              return {
                content: [
                  ...(prose ? [{ type: "text" as const, text: prose }] : []),
                  ...parsed.calls.map((call, index) => ({
                    type: "tool-call" as const,
                    toolCallId: "webbridge-tool-" + (index + 1),
                    toolName: call.toolName, input: call.input,
                  })),
                ],
                finishReason: { unified: "tool-calls" as const, raw: TOOL_CALLS_RAW },
                usage: UNKNOWN_USAGE,
                warnings: [],
                providerMetadata: metadata(state, reason),
              };
            }
          }
        }
        return {
          content: text ? [{ type: "text" as const, text }] : [],
          finishReason: terminalReason(state),
          usage: UNKNOWN_USAGE,
          warnings: [],
          providerMetadata: metadata(state, reason),
        };
      };
      for await (const event of session.stream(request(call))) {
        if (event.kind === "fragment") text += event.text;
        else return finish(event.state, event.reason);
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
          const emitText = (delta: string) => {
            if (!delta) return;
            if (!opened) {
              opened = true;
              controller.enqueue({ type: "text-start", id: TEXT_ID });
            }
            controller.enqueue({ type: "text-delta", id: TEXT_ID, delta });
          };
          // Without the bridge this is exactly the previous behaviour: every
          // fragment is forwarded as text. With the bridge we hold back a possible
          // fence prefix so a tool block is never shown as text mid-flight.
          let acc = "";
          let sent = 0;
          let fence = -1;
          const consume = (delta: string) => {
            if (!delta) return;
            acc += delta;
            if (!toolBridge) { emitText(delta); sent = acc.length; return; }
            if (fence >= 0) return; // inside a block: hold everything until we know
            const at = firstFenceIndex(acc);
            if (at >= 0) {
              fence = at;
              if (at > sent) { emitText(acc.slice(sent, at)); sent = at; }
              return;
            }
            const safeEnd = acc.length - holdBack(acc);
            if (safeEnd > sent) { emitText(acc.slice(sent, safeEnd)); sent = safeEnd; }
          };
          const settle = (state: NativeTerminalState, reason: string) => {
            // A tool call is executed ONLY when the browser turn is itself proven
            // complete: an effect is never run on an unproven turn. On any other
            // terminal the text (block included) is delivered verbatim.
            if (toolBridge && fence >= 0 && state === "complete") {
              const parsed = parseToolCalls(acc.slice(fence));
              if (parsed.calls.length) {
                closeText();
                let index = 0;
                for (const call of parsed.calls) {
                  controller.enqueue({
                    type: "tool-call", toolCallId: "webbridge-tool-" + (++index),
                    toolName: call.toolName, input: call.input,
                  });
                }
                controller.enqueue({
                  type: "finish", usage: UNKNOWN_USAGE,
                  finishReason: { unified: "tool-calls", raw: TOOL_CALLS_RAW },
                  providerMetadata: metadata(state, reason),
                });
                controller.close();
                return;
              }
            }
            if (acc.length > sent) { emitText(acc.slice(sent)); sent = acc.length; }
            closeText();
            controller.enqueue({
              type: "finish", usage: UNKNOWN_USAGE,
              finishReason: terminalReason(state),
              providerMetadata: metadata(state, reason),
            });
            controller.close();
          };
          try {
            for await (const event of session.stream(turn)) {
              if (event.kind === "fragment") { consume(event.text); continue; }
              settle(event.state, event.reason);
              return;
            }
            settle("uncertain", "transport-ended-without-terminal");
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
