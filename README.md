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

See [Global production plan (FR)](docs/PLAN-GLOBAL.fr.md), [Architecture and milestones](docs/ARCHITECTURE.md), [Security policy](SECURITY.md), [French roadmap](docs/ROADMAP.fr.md), and [Backlog (9 epics / 54 user stories)](planning/backlog.json). The backlog is validated in CI and synchronized to GitHub issues via `npm run issues:sync` by authorized maintainers.

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

## Native models (experimental, dormant by default)

`src/index.ts` can register the five web providers as native OpenCode models through public SDK
surfaces only (`ctx.provider.transform` + a scoped `ctx.aisdk.hook('language')` with a packaged
anchor module). Registration is **dormant** unless the user individually activates a provider:

```sh
WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt opencode run --model webbridge-chatgpt/chatgpt-web "..."
```

### Consented browser session (per provider, per tab)

A model only ever drives a browser tab the operator declares explicitly. Two environment
variables are required together:

```sh
# One already-open tab, selected by its CDP target id (ChatGPT only for now):
WEBBRIDGE_NATIVE_TAB_CHATGPT=http://127.0.0.1:9222#<tabID>
# An existing private, operator-owned directory for the durable attempt journal:
WEBBRIDGE_NATIVE_JOURNAL_DIR=~/.webbridge/journal   # mkdir -m 700 it first
```

Start Chrome/Chromium with a **dedicated** `--user-data-dir` and `--remote-debugging-port=9222`
(Chrome 136+ refuses a debug port on the default profile; sign in to the provider inside that
profile if the tab you consent to requires it), open e.g. `https://chatgpt.com` in exactly one
tab, and read that tab's target id from `http://127.0.0.1:9222/json/list` (the `id` of the page
whose `url` is on the provider origin). Declaring the tab **is** the authorization — there is no
per-send prompt, because `ctx.aisdk.hook('language')` receives no session identity (see
`docs/proposals/plugin-provided-language-model.fr.md`). Revocation = remove the declaration and
restart OpenCode; a tab that is closed, replaced or navigated away is refused at every read.
The audited send primitive caps the submitted prompt at 4000 characters, and a declared tab
whose browser is unreachable refuses explicitly before any UI effect.

Honest state rules that are enforced by construction:

- without an attached, explicitly authorized browser session the model **refuses** with an
  explicit error; no text is ever fabricated, and no fixture is ever presented as a provider answer;
- a **proven** DOM completion becomes `stop` with the explicit raw marker
  `webbridge-dom-completion-observed`; anything unproven becomes an `error` finish with
  `webbridge-terminal-uncertain` (OpenCode 2.0.32 has no first-class UNCERTAIN terminal).
  No completion proof for the ChatGPT DOM exists yet, so real turns end `uncertain` today;
- every turn records an attempt (atomically, temp+fsync+rename) in the journal **before** any UI
  effect: a retried model call re-observes the same browser turn instead of submitting the prompt
  twice, a possibly-sent turn is never replayed, and a corrupt record refuses the turn instead of
  being read as "no record";
- core auxiliary calls (thread titles) are answered locally and never reach a browser;
- only ChatGPT has a reviewed send primitive today; declaring a tab for another provider is
  refused loudly instead of half-working.

The read-only side is provider-wide: `webbridge-manual-observe` attaches one already-open declared
tab (every provider), discovers the latest assistant message, displays it for confirmation
(`--message` skips discovery) and streams bounded `[UNVERIFIED]` fragments. It never sends, never
claims finality, and Qwen ends `NO-GO` after a real readiness probe. Per-provider capabilities are
single-sourced in `src/providers/provider-adapters.ts` (read primitive, discovery, send, completion
proof, notes); see `docs/OBSERVE-PROVIDER.fr.md`.

The durable attempt journal (`WEBBRIDGE_NATIVE_JOURNAL_DIR`) is operator-inspectable and explicitly
reconcilable: `webbridge-journal` lists every attempt (state, turn, selected message, acknowledged
cursor, tab scope, age — never assistant text) and `--abandon <turnID|key-prefix>` closes a
provisional attempt so a later identical prompt becomes a new turn instead of being reconciled onto a
possibly-stale browser turn. It never claims a completion; see `docs/JOURNAL-OPERATOR.fr.md`.

The browser transport used by the CLI test is a token-gated fixture that labels itself
`[WebBridge test fixture - NOT a provider answer]`; it cannot activate without a 64-hex token and
it is never a substitute for a real authenticated session.

## Development

Requires Node.js 22.19+ and an OpenCode 2 installation for eventual smoke tests.

```sh
npm ci
npm run typecheck
npm test
```

This repository intentionally does not advertise an install command until the native provider lifecycle has been validated. The current entrypoint registers tools/models only under explicit individual opt-in; the raw npm package installs, registers a provider, and serves the plugin model through the official CLI (`test/native-web-models-cli.test.ts`).

## Origins and attribution

Inspired by [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids) (MIT-licensed), in particular its durable worker coordination and recovery ideas. This repository was started as an independent TypeScript project, **not** as a full copy of its Electron/Chromium codebase. If source is ported, retain the original copyright, license and attribution in the relevant files.

Not affiliated with or endorsed by OpenCode, OpenAI, DeepSeek, Google, Alibaba/Qwen, Mistral, or the authors of Chat On Steroids. Use each service in accordance with its applicable terms.

## License

MIT. See [LICENSE](LICENSE).
