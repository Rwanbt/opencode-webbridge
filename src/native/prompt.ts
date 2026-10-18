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
