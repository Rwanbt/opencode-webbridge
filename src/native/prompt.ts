/** Prompt inspection for the native model. All content here is untrusted data. */
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";

const contentText = (content: unknown): string => {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const candidate = part as { readonly type?: unknown; readonly text?: unknown };
    if (candidate.type === "text" && typeof candidate.text === "string") texts.push(candidate.text);
  }
  return texts.join("\n").trim();
};

const roleText = (prompt: LanguageModelV3Prompt, role: string): string => {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .filter((message) => (message as { readonly role?: unknown })?.role === role)
    .map((message) => contentText((message as { readonly content?: unknown }).content))
    .filter(Boolean)
    .join("\n");
};

/** Exact text of the last non-empty user message (what the user asked). */
export function lastUserText(prompt: LanguageModelV3Prompt): string {
  if (!Array.isArray(prompt)) return "";
  for (let index = prompt.length - 1; index >= 0; index -= 1) {
    const message = prompt[index] as { readonly role?: unknown; readonly content?: unknown } | undefined;
    if (!message || message.role !== "user") continue;
    const text = contentText(message.content);
    if (text) return text;
  }
  return "";
}

/** Tool results already produced by OpenCode, in order. A web chat UI has no
 *  tool channel, so they must be handed back to it as plain text. The SDK shape
 *  is `{ type: 'tool-result', toolName, output }` — reading it as text would
 *  silently send nothing, which is why this reads the real field. */
export function toolResults(prompt: LanguageModelV3Prompt): readonly string[] {
  if (!Array.isArray(prompt)) return [];
  const results: string[] = [];
  for (const message of prompt) {
    const entry = message as { readonly role?: unknown; readonly content?: unknown } | undefined;
    if (!entry || entry.role !== "tool" || !Array.isArray(entry.content)) continue;
    for (const raw of entry.content as readonly Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object" || raw.type !== "tool-result") continue;
      const name = typeof raw.toolName === "string" && raw.toolName ? raw.toolName : "tool";
      const output = raw.output as { readonly type?: unknown; readonly value?: unknown } | undefined;
      if (!output) continue;
      if (output.type === "text" && typeof output.value === "string") {
        results.push("[" + name + "]\n" + output.value);
      } else if (output.type === "json") {
        results.push("[" + name + "]\n" + JSON.stringify(output.value));
      } else {
        results.push("[" + name + "] execution denied by the user");
      }
    }
  }
  return results;
}

/** What the browser actually receives: the tool contract (only when the bridge
 *  is on), the user's question, then any tool results. Everything here is data
 *  handed to an untrusted page; it is never treated as an instruction to us. */
export function browserPrompt(prompt: LanguageModelV3Prompt, contract: string | null): string {
  const parts: string[] = [];
  if (contract) parts.push(contract);
  const question = lastUserText(prompt);
  if (question) parts.push(question);
  for (const result of toolResults(prompt)) parts.push("TOOL RESULT:\n" + result);
  return parts.join("\n\n");
}

/** Core auxiliary calls (thread title) must never become a browser turn. */
export function isTitleGeneration(prompt: LanguageModelV3Prompt): boolean {
  return /title generator/i.test(roleText(prompt, "system"));
}

/** Deterministic, bounded session label. Never presented as provider output. */
export function localTitle(prompt: LanguageModelV3Prompt): string {
  const first = lastUserText(prompt).split(/\r?\n/, 1)[0] ?? "";
  const collapsed = first
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_#>|[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.slice(0, 60).trim() || "WebBridge session";
}
