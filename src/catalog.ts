/** Exact site origins for explicitly attached CDP tabs. Inference is not enabled. */
export const WEB_PROVIDER_CATALOG = [
  { id: "chatgpt", name: "ChatGPT", origin: "https://chatgpt.com" },
  { id: "deepseek", name: "DeepSeek", origin: "https://chat.deepseek.com" },
  { id: "gemini", name: "Gemini", origin: "https://gemini.google.com" },
  { id: "qwen", name: "Qwen", origin: "https://chat.qwen.ai" },
  { id: "mistral", name: "Mistral Le Chat", origin: "https://chat.mistral.ai" },
] as const;

export type WebProviderID = (typeof WEB_PROVIDER_CATALOG)[number]["id"];
