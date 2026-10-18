/** Shared contract between a WebBridge native model turn and a browser session.
 *
 * The transport is the ONLY component allowed to touch a browser. The model
 * never fabricates text: without an attached, explicitly authorized session the
 * model refuses (explicit state), and a terminal that is not proven is reported
 * as an error finish reason instead of a false completion.
 *
 * Anti-replay contract: implementations MUST NOT issue a second browser send for
 * an identical (providerID, modelID, prompt) turn. A retried turn must re-observe
 * the SAME browser turn instead of submitting the prompt again. */
export type NativeTerminalState = "complete" | "uncertain" | "cancelled";

export interface NativeTurnRequest {
  readonly providerID: string;
  readonly modelID: string;
  /** Exact user text submitted to the provider web chat. */
  readonly prompt: string;
  readonly signal: AbortSignal;
}

export type NativeTurnEvent =
  | { readonly kind: "fragment"; readonly text: string }
  | { readonly kind: "terminal"; readonly state: NativeTerminalState; readonly reason: string };

export interface NativeTurnTransport {
  stream(request: NativeTurnRequest): AsyncIterable<NativeTurnEvent>;
}

/** Explicit, actionable state: no attached session, no fabricated answer. */
export class WebBridgeSessionStateError extends Error {
  constructor(providerName: string, detail: string) {
    super(`WebBridge ${providerName}: ${detail}`);
    this.name = "WebBridgeSessionStateError";
  }
}
