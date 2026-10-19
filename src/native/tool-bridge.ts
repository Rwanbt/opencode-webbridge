/** Tool bridge: lets a WEB chat model call OpenCode tools exactly like an API
 *  model does.
 *
 *  A chat UI has no tool channel — it only returns text — so the bridge puts the
 *  tool definitions OpenCode actually offers into the prompt, asks for a fenced
 *  block, and turns a well-formed block back into a real `tool-call` stream part.
 *  OpenCode then executes it and calls the model again with the result, which
 *  `browserPrompt` renders into the next browser prompt. That is the same
 *  tool-call → tool-result → continue loop an API provider gets, reached through
 *  text.
 *
 *  The offered tools are NOT hard-coded here: they come from the model call. Any
 *  tool OpenCode exposes can be called, which is what parity means — including
 *  tools that write. Two rules keep it honest:
 *
 *  1. **All or nothing.** If any block is malformed, names a tool that was not
 *     offered, or there are more than MAX_TOOL_CALLS, NO call is emitted and the
 *     response is delivered verbatim as text. Executing a subset the model did
 *     not intend would be an effect we cannot attribute to it.
 *  2. **Never on an unproven turn.** A call is emitted only when the browser turn
 *     itself ended `complete`. On an uncertain turn the text — block included —
 *     is delivered as-is and the terminal stays honest.
 *
 *  The bridge is opt-in (WEBBRIDGE_NATIVE_TOOL_BRIDGE / `toolBridge`). */

export const TOOL_BRIDGE_OPT = "WEBBRIDGE_NATIVE_TOOL_BRIDGE";
export const TOOL_FENCE = "```webbridge-tool";
export const MAX_TOOL_CALLS = 4;
export const MAX_OFFERED_TOOLS = 32;

const FENCE_CLOSE = "```";
const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

export function toolBridgeEnabled(env: Record<string, string | undefined>): boolean {
  return env[TOOL_BRIDGE_OPT] === "1";
}

/** One tool as the model call declares it. */
export interface OfferedTool {
  readonly name: string;
  readonly description?: string;
}

/** The contract injected into the prompt, built from the tools OpenCode offers. */
export function toolContract(tools: readonly OfferedTool[]): string {
  const offered = tools
    .filter((tool) => typeof tool?.name === "string" && TOOL_NAME.test(tool.name))
    .slice(0, MAX_OFFERED_TOOLS);
  const lines = [
    "You can call the tools listed at the end of this message.",
    "To call one, reply with a fenced block containing a single JSON object and nothing else in that block:",
    TOOL_FENCE,
    '{"tool":"<name>","args":{...}}',
    FENCE_CLOSE,
    "Rules: at most " + MAX_TOOL_CALLS + " blocks; `tool` must be exactly one of the listed names;",
    "`args` must be a JSON object matching that tool's parameters; put no prose inside a block.",
    "If you do not need a tool, answer normally in prose and emit no block.",
    "Tools:",
  ];
  for (const tool of offered) {
    const description = typeof tool.description === "string" ? tool.description.replace(/\s+/g, " ").slice(0, 140) : "";
    lines.push("- " + tool.name + (description ? ": " + description : ""));
  }
  return lines.join("\n");
}

export interface ParsedToolCall {
  readonly toolName: string;
  /** Stringified JSON object, exactly as the SDK expects it. */
  readonly input: string;
}

export interface ToolParseResult {
  /** The calls to execute; empty means "deliver the text as prose". */
  readonly calls: readonly ParsedToolCall[];
  /** True when a block was present but refused (malformed, unoffered tool, too many). */
  readonly refused: boolean;
}

const oneCall = (raw: string, allowed: ReadonlySet<string>): ParsedToolCall | null => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "tool" && key !== "args")) return null;
  const name = record.tool;
  // Parity, not improvisation: only a tool the model call actually offered.
  if (typeof name !== "string" || !allowed.has(name)) return null;
  const args = record.args;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  if (Object.keys(args).length > 64) return null;
  return Object.freeze({ toolName: name, input: JSON.stringify(args) });
};

/** Parses the text STARTING AT a fence. Anything else is prose and is kept. */
export function parseToolCalls(fromFence: string, allowed: ReadonlySet<string>): ToolParseResult {
  const segments = fromFence.split(TOOL_FENCE);
  const blocks = segments.slice(1);
  if (blocks.length === 0) return { calls: [], refused: false };
  if (blocks.length > MAX_TOOL_CALLS) return { calls: [], refused: true };
  const calls: ParsedToolCall[] = [];
  for (const block of blocks) {
    const end = block.indexOf(FENCE_CLOSE);
    if (end < 0) return { calls: [], refused: true }; // unterminated block
    const call = oneCall(block.slice(0, end), allowed);
    if (!call) return { calls: [], refused: true };   // malformed: refuse them ALL
    calls.push(call);
  }
  return { calls: Object.freeze(calls), refused: false };
}

/** The names a call may use, taken from the model call itself. */
export function offeredToolNames(tools: unknown): ReadonlySet<string> {
  if (!Array.isArray(tools)) return new Set();
  const names = new Set<string>();
  for (const tool of tools) {
    const entry = tool as { readonly type?: unknown; readonly name?: unknown } | undefined;
    if (!entry || entry.type !== "function" || typeof entry.name !== "string") continue;
    if (TOOL_NAME.test(entry.name)) names.add(entry.name);
  }
  return names;
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
