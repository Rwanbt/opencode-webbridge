# OpenCode WebBridge

**Web accounts. Native agents. One bridge.**

OpenCode WebBridge is an experimental, open-source project to connect **OpenCode 2** to user-authenticated web chat interfaces without requiring inference API keys. The five planned adapters are **ChatGPT, DeepSeek, Gemini, Qwen and Mistral Le Chat**.

> **Status: architecture and plugin scaffold only.** No provider transport or website automation is implemented, no account connection is performed, and no web-chat model is available through OpenCode yet. Do not install this expecting functional model inference.

## Goals

- **Native OpenCode provider experience:** eventually expose working web-chat transports in OpenCode's model picker, sessions, and agent workflow.
- **Browser first:** use the browser attached to OpenCode 2 where its supported capabilities permit; avoid an independent Electron application or hidden browser.
- **User-authenticated sessions:** sign in manually on each service's own website. Never request or extract a password, session cookie, or access token.
- **Common transport:** share conversation state, output capture, tool-call protocol, retries, idempotency, permission checks, and recovery logic across adapters.
- **Safety by default:** disabled until each adapter is individually validated technically and against the service's applicable terms and restrictions. Never bypass CAPTCHA, rate limits, anti-bot controls, paywalls, or access refusals.

## Target providers

| Adapter ID | Website | Status |
| --- | --- | --- |
| `chatgpt` | https://chatgpt.com | Planned; not connected |
| `deepseek` | https://chat.deepseek.com | Planned; not connected |
| `gemini` | https://gemini.google.com | Planned; not connected |
| `qwen` | https://chat.qwen.ai | Planned; not connected |
| `mistral` | https://chat.mistral.ai | Planned; not connected |

Websites and availability can change. A displayed website is **not** evidence that automated use is permitted. Provider functionality must remain disabled until verified.

## Architecture

See [Architecture and milestones](docs/ARCHITECTURE.md), [Security policy](SECURITY.md), and [French roadmap](docs/ROADMAP.fr.md).

The intended design is:

```text
OpenCode 2 (sessions, agents, permissions, tools, model picker)
    |
    v
WebBridge native plugin and provider transport
    |
    +-- browser integration contract (validation required)
    +-- durable session/conversation mapping
    +-- response and tool protocol (validated, replay-safe)
    +-- provider adapters: ChatGPT / DeepSeek / Gemini / Qwen / Mistral
    |
    v
Explicitly user-authenticated website, if automation is permitted
```

OpenCode's documentation describes [`@opencode/plugin` v2](https://opencode.ai/v2/docs/build/plugins/) and an [integrated browser tool](https://opencode.ai/v2/docs/tools/). These do **not**, by themselves, prove a server plugin can control an existing browser tab or supply native inference. Both integration points need an experimental proof before activating a provider.

## Development

Requires Node.js 22.19+ and an OpenCode 2 installation for eventual smoke tests.

```sh
npm ci
npm run typecheck
npm test
```

This repository intentionally does not advertise an install command until the native provider lifecycle has been validated. The current entrypoint in `src/index.ts` registers no models or tools.

## Origins and attribution

Inspired by [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids) (MIT-licensed), in particular its durable worker coordination and recovery ideas. This repository was started as an independent TypeScript project, **not** as a full copy of its Electron/Chromium codebase. If source is ported, retain the original copyright, license and attribution in the relevant files.

Not affiliated with or endorsed by OpenCode, OpenAI, DeepSeek, Google, Alibaba/Qwen, Mistral, or the authors of Chat On Steroids. Use each service in accordance with its applicable terms.

## License

MIT. See [LICENSE](LICENSE).
