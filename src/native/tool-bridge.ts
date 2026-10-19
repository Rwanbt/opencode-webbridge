/** Tool bridge: lets a WEB chat model drive OpenCode's read-only tools.
 *
 *  A web chat UI has no notion of tools: it only returns text. So the bridge
 *  does what Chat On Steroids does — it puts a compact contract in the prompt,
 *  asks for a fenced block, and turns a well-formed block back into a real
 *  `tool-call` stream part so OpenCode executes the tool.
 *
 *  Two rules keep this honest:
 *
 *  1. **All or nothing.** If any block is malformed, or there are more than
 *     MAX_TOOL_CALLS, NO call is emitted and the response is delivered verbatim
 *     as text. Executing a subset the model did not intend would be an effect we
 *     cannot attribute to it.
 *  2. **Read-only surface only.** The bridge can only name the read-only tool
 *     (`webbridge_readonly`), which cannot write. Enabling writes is a separate,
 *     deliberate decision.
 *
 *  The bridge is opt-in: without WEBBRIDGE_NATIVE_TOOL_BRIDGE the model stays
 *  exactly as before (text only, `tools: false`). */

export const TOOL_BRIDGE_OPT = "WEBBRIDGE_NATIVE_TOOL_BRIDGE";
export const BRIDGE_TOOL_NAME = "webbridge_readonly";
export const TOOL_FENCE = "```webbridge-tool";
export const MAX_TOOL_CALLS = 4;

const FENCE_CLOSE = "```";

export function toolBridgeEnabled(env: Record<string, string | undefined>): boolean {
  return env[TOOL_BRIDGE_OPT] === "1";
}

/** The contract injected into the prompt sent to the browser. */
export function toolContract(): string {
  return [
    "You may call ONE read-only workspace tool. It cannot write anything.",
    "To call it, reply with a single fenced block and nothing else in that block:",
    TOOL_FENCE,
    '{"tool":"' + BRIDGE_TOOL_NAME + '","args":{"action":"file.read|git.status|git.diff|git.log","path":"<path>"}}',
    FENCE_CLOSE,
    "Rules: at most " + MAX_TOOL_CALLS + " blocks; `action` must be one of the four listed;",
    "`path` is required for file.read and optional for git.diff; use relative paths inside the workspace.",
    "If you do not need a tool, answer normally in prose and do not emit any block.",
  ].join("\n");
}

export interface ParsedToolCall {
  readonly toolName: string;
  /** Stringified JSON object, exactly as the SDK expects it. */
  readonly input: string;
}

export interface ToolParseResult {
  /** The calls to execute; empty means "deliver the text as prose". */
  readonly calls: readonly ParsedToolCall[];
  /** True when a block was present but refused (malformed, unknown tool, too many). */
  readonly refused: boolean;
}

const oneCall = (raw: string): ParsedToolCall | null => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "tool" && key !== "args")) return null;
  if (record.tool !== BRIDGE_TOOL_NAME) return null;
  const args = record.args;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  const fields = args as Record<string, unknown>;
  if (Object.keys(fields).some((key) => key !== "action" && key !== "path")) return null;
  const action = fields.action;
  if (action !== "file.read" && action !== "git.status" && action !== "git.diff" && action !== "git.log")
    return null;
  const path = fields.path;
  if (path !== undefined && (typeof path !== "string" || !path.trim() || path.length > 512)) return null;
  if (action === "file.read" && typeof path !== "string") return null;
  const input: Record<string, unknown> = { action };
  if (typeof path === "string") input.path = path;
  return Object.freeze({ toolName: BRIDGE_TOOL_NAME, input: JSON.stringify(input) });
};

/** Parses the text STARTING AT a fence. Anything else is prose and is kept. */
export function parseToolCalls(fromFence: string): ToolParseResult {
  const segments = fromFence.split(TOOL_FENCE);
  // segments[0] is prose before the first fence; each later segment is a block.
  const blocks = segments.slice(1);
  if (blocks.length === 0) return { calls: [], refused: false };
  if (blocks.length > MAX_TOOL_CALLS) return { calls: [], refused: true };
  const calls: ParsedToolCall[] = [];
  for (const block of blocks) {
    const end = block.indexOf(FENCE_CLOSE);
    if (end < 0) return { calls: [], refused: true }; // unterminated block
    const call = oneCall(block.slice(0, end));
    if (!call) return { calls: [], refused: true };   // malformed: refuse them ALL
    calls.push(call);
  }
  return { calls: Object.freeze(calls), refused: false };
}

/** True when the accumulated text already contains a fence marker. */
export function firstFenceIndex(text: string): number {
  return text.indexOf(TOOL_FENCE);
}

/** Longest suffix of `text` that could still become a fence: never emit it yet. */
export function holdBack(text: string): number {
  const max = Math.min(TOOL_FENCE.length - 1, text.length);
  for (let size = max; size > 0; size -= 1) {
    if (TOOL_FENCE.startsWith(text.slice(text.length - size))) return size;
  }
  return 0;
}
