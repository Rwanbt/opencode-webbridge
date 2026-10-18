# OpenCode WebBridge

**Web accounts. Native agents. One bridge.**

OpenCode WebBridge is an experimental, open-source plugin that connects **OpenCode 2** to
user-authenticated web chat interfaces **without inference API keys**: ChatGPT, DeepSeek,
Gemini, Qwen and Mistral Le Chat.

> **Status: experimental pre-release (`0.0.0`, unpublished).** The plugin installs from its raw
> npm archive into the official OpenCode CLI and serves the five providers as native models.
> A real authenticated conversation with a verified answer has been demonstrated for each of the
> five. It is **not production-ready**: the DOM has no proven completion signal, so every turn
> ends `UNCERTAIN` (OpenCode shows it as an error), and production acceptance is `0/54`. See
> *Honest limits* below.

## Quickstart (about 10 minutes)

```sh
# 1. Build the real package (no manual copy of dist/)
git clone https://github.com/Rwanbt/opencode-webbridge && cd opencode-webbridge
npm ci && npm pack                       # -> opencode-webbridge-0.0.0.tgz
npm install -g ./opencode-webbridge-0.0.0.tgz

# 2. Start a DEDICATED browser profile with a debug port and sign in there
#    (Chrome/Brave refuses a debug port on the default profile)
chromium --remote-debugging-port=9222 --user-data-dir=/tmp/webbridge-profile

# 3. Let the doctor find your tab and print the exact configuration
webbridge-doctor --journal ~/.webbridge/journal

# 4. Paste the printed export lines, then run one turn
opencode run --model webbridge-chatgpt/chatgpt-web "combien font 2 + 2 ?"

# 5. Or verify every configured provider with one prompt each
webbridge-selftest --provider chatgpt --yes
```

`webbridge-doctor` is read-only: it lists the open tabs per provider origin and prints the
environment lines. It never reads cookies, tokens or passwords and never sends anything.

## Providers

| Adapter | Website | Native model | Live conversation |
| --- | --- | --- | --- |
| `chatgpt` | https://chatgpt.com | `webbridge-chatgpt/chatgpt-web` | verified (one turn) |
| `deepseek` | https://chat.deepseek.com | `webbridge-deepseek/deepseek-web` | verified (one turn) |
| `gemini` | https://gemini.google.com | `webbridge-gemini/gemini-web` | verified (one turn) |
| `qwen` | https://chat.qwen.ai | `webbridge-qwen/qwen-web` | verified (one turn) |
| `mistral` | https://chat.mistral.ai | `webbridge-mistral/mistral-web` | verified (one turn) |

"Verified" means one authenticated conversation produced a real, streamed answer persisted in an
official OpenCode session. It does **not** mean production acceptance, and it does not survive a
provider UI redesign.

## How it works

- **Native models through public SDK surfaces only.** `ctx.provider.transform` registers the
  provider/models; a scoped `ctx.aisdk.hook('language')` with a packaged anchor module supplies the
  model. Registration is dormant until you activate a provider with
  `WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt,deepseek,...`.
- **Consented browser session, per provider and per tab.** Declaring the tab *is* the
  authorization: `WEBBRIDGE_NATIVE_TAB_<PROVIDER>=http://127.0.0.1:<port>#<tabID>` plus a private
  `WEBBRIDGE_NATIVE_JOURNAL_DIR`. OpenCode 2.0.32's language hook carries no session identity, so
  there is no per-send native prompt (see `docs/proposals/plugin-provided-language-model.fr.md`).
- **Durable anti-replay journal.** Every turn records an attempt (temp + fsync + rename) *before*
  any UI effect: a retried model call re-observes the same browser turn instead of submitting
  twice, a possibly-sent turn is never replayed, and a corrupt record refuses the turn.
- **Provider-specific send primitives** share one reviewed contract: composer required before the
  fill, send control resolved after it, the one-shot consumed before any UI effect, never replayed.

## Honest limits

- **No completion proof.** No provider DOM exposes a trustworthy "finished" signal, so turns end
  `finish: "error"` with `webbridge-terminal-uncertain`. The answer still arrives and is persisted;
  OpenCode merely reports the turn as unfinished. A fabricated `stop` is never emitted.
- **Deliberate, not an oversight:** emitting an optimistic `stop` after DOM silence was considered
  and rejected. A false completion silently corrupts agent loops, whereas an honest `UNCERTAIN`
  only costs a retry decision. The upstream fix (a first-class `uncertain` terminal) is proposed in
  `docs/proposals/`.
- **Not production-accepted.** `productionAcceptedStoryIDs` is `[]` (0/54): login/logout, completion
  and error coverage are not demonstrated. Release posture is `NO-GO-PRODUCTION`.
- **No per-turn native permission.** Authorization is the declared tab, not a native prompt, because
  the public language hook has no session identity.
- **Desktop/Electron is not supported.** The packaged app refuses extension installation
  (`docs/DESKTOP-LEVELS.fr.md`).
- **Selectors are fragile.** They were verified against each live UI at one point in time; a
  redesign breaks an adapter (it fails closed, it does not guess).

## Operations

- `webbridge-doctor` — read-only setup check and ready-to-paste configuration.
- `webbridge-selftest` — one real prompt per provider (`--yes` required), prints the verdict.
- `webbridge-manual-observe` — read-only observation of one declared tab, never sends.
- `webbridge-journal` — inspect or explicitly close (`--abandon`) a provisional attempt.

See `docs/INSTALL.fr.md`, `docs/INSTALL-DIAGNOSTICS.fr.md`, `docs/REFUSALS.fr.md`,
`docs/SECURITY-MATRIX.fr.md`, `docs/TRACEABILITY.fr.md` and `docs/QUALIFICATION.fr.md`.

## Development

Requires Node.js **22.19+** and an OpenCode 2 installation for the official-CLI tests.

```sh
npm ci
npm run typecheck
npm test
npm run check:release      # NO-GO-PRODUCTION posture
```

## Origins and attribution

Inspired by [Chat On Steroids](https://github.com/totec448-spec/chat-on-steroids) (MIT-licensed),
in particular its durable worker coordination. This repository is an independent TypeScript
project, not a copy of its Electron/Chromium codebase.

Not affiliated with or endorsed by OpenCode, OpenAI, DeepSeek, Google, Alibaba/Qwen or Mistral.
Use each service in accordance with its applicable terms. This project never bypasses CAPTCHA,
authentication, rate limits or access controls.

## License

MIT. See [LICENSE](LICENSE).
