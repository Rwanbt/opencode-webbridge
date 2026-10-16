# ADR-0001 — Model runtime and integrated-browser boundary

Status: **PROVISIONAL / SPIKE REQUIRED** · 2026-10-17 · tracked in [#1](https://github.com/Rwanbt/opencode-webbridge/issues/1), [US-E1-01](https://github.com/Rwanbt/opencode-webbridge/issues/19), [US-E2-01](https://github.com/Rwanbt/opencode-webbridge/issues/25).

## Context and confirmed facts

Local installation: OpenCode CLI **v2.0.29** on Windows, Node **22.15.1**. Dependency was pinned to `@opencode/plugin@2.0.29` for a reproducible integration baseline.

OpenCode's provider system accepts custom runtime packages or an OpenAI-compatible local endpoint, and plugins can register provider/model source definitions through `ctx.provider.transform`. This only proves catalog configuration and a possible runtime boundary — **not** browser-backed inference. Sources: https://dev.opencode.ai/v2/docs/providers/ and https://dev.opencode.ai/v2/docs/build/plugins/.

OpenCode's `browser` tools use a browser attached to the desktop app with an explicit `tabID`. The public `Context` types in both `@opencode/plugin@2.0.32` **and pinned `2.0.29`** were inspected: both expose `provider`, `model`, `tool`, `session`, etc. and **no `browser` property**. This is evidence of a missing **public direct plugin browser API**, not proof that a supported mediated path is impossible. Source: https://dev.opencode.ai/v2/docs/tools/.

An isolated `opencode plugin list` smoke using a temp config pointing at `dist/src/index.js` returned **`No plugins found`**. This is a CLI/plugin-manager listing, **not proof that a server plugin was loaded**. A `--standalone` flag before `plugin list` was rejected by the CLI parser. More precise investigation is captured in [G1 Native Runtime](../G1-NATIVE-RUNTIME.fr.md): the exact v2.0.29 runtime logs **`configured plugin path must be a directory`** for `file://` JavaScript entrypoints, despite broader official documentation examples. Manifest-backed directories fix that, and a full OpenCode native session now successfully invokes the test-only local fixture server. No global config or credentials were modified.

## Decision

**Implement an isolated, typed `BrowserPort` and a `ProviderGate` that fails closed.** A deterministic `FakeBrowserPort` is permitted for local/unit tests, but it has no external transport. Do not register fake providers or accounts in the actual OpenCode model picker.

**Native runtime execution has been demonstrated** through a test-only manifest-backed plugin, an explicitly fake model, and an OpenAI-compatible loopback fixture on OpenCode v2.0.29. The eventual browser-backed inference runtime can use a separately consented and authenticated local transport or custom provider package only after browser and policy gates pass. Never route web chat through private undocumented site endpoints, stolen browser credentials, unrestricted automation or a network-exposed bridge.

If no supported direct browser control API exists, investigate an officially supported mediated tool call or an explicitly user-approved manual mode. Record any remaining OpenCode core enhancement requirement rather than silently patching OpenCode internals.

## Consequences and follow-up

Positive: testable session isolation, replay-safe protocol, no accidental web account activity. Tradeoff: initially no usable web model and no claim that all five providers will be allowed. Next experiment must boot the exact OpenCode server in a disposable config/profile and use its `/api/plugin` route (if available) to assert the plugin instance is loaded. A standalone mock inference transport must then exercise a real model invocation.

The complete policy review per provider is independent of technical feasibility. For example OpenAI's European terms prohibit programmatic extraction of service output: https://openai.com/en-GB/policies/eu-terms-of-use/. This must not be treated as permission for a hidden browser bridge. The browser part of G1 remains unproven.
