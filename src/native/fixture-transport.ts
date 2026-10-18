/** TEST-ONLY deterministic transport. It proves the native model chain end to end
 * inside the official CLI; it is NEVER a provider answer and refuses to activate
 * without an explicit 64-hex authorization token. */
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { NativeTerminalState, NativeTurnEvent, NativeTurnRequest, NativeTurnTransport } from "./turn-transport.js";

export const FIXTURE_MARKER = "WEBBRIDGE_FIXTURE_STREAM_OK";
export const FIXTURE_PREFIX = "[WebBridge test fixture - NOT a provider answer]";

const STATES: readonly NativeTerminalState[] = ["complete", "uncertain", "cancelled"];

export function fixtureTransport(env: NodeJS.ProcessEnv): NativeTurnTransport | null {
  if (env.WEBBRIDGE_NATIVE_MODEL_FIXTURE !== "1") return null;
  if (!/^[a-f0-9]{64}$/.test(env.WEBBRIDGE_NATIVE_MODEL_FIXTURE_TOKEN ?? "")) {
    throw new Error("WebBridge fixture authorization missing: 64-hex token required");
  }
  const state = (env.WEBBRIDGE_NATIVE_MODEL_FIXTURE_STATE ?? "complete") as NativeTerminalState;
  if (!STATES.includes(state)) throw new Error("WebBridge fixture terminal state unsupported");
  const logPath = env.WEBBRIDGE_NATIVE_MODEL_FIXTURE_LOG;
  let turn = 0;
  const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
  return {
    async *stream(request: NativeTurnRequest): AsyncIterable<NativeTurnEvent> {
      turn += 1;
      if (logPath) {
        appendFileSync(logPath, `fixture-turn:${turn}:${request.providerID}/${request.modelID}:`
          + `prompt-${hash(request.prompt)}:${state}\n`);
      }
      yield { kind: "fragment", text: `${FIXTURE_PREFIX} ` };
      yield { kind: "fragment", text: `${FIXTURE_MARKER} ${request.providerID}/${request.modelID}` };
      yield { kind: "terminal", state, reason: `fixture-${state}` };
    },
  };
}
