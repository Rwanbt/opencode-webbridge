# Architecture and acceptance gates

## Target

Implement an OpenCode **2.x native model-provider experience** backed by user-authenticated web chat interfaces for ChatGPT, DeepSeek, Gemini, Qwen and Mistral Le Chat. This is not a browser chatbot UI, not an API-key reseller, and not five standalone browser scripts.

## Non-negotiable unknowns

- Confirm that an OpenCode 2 **server plugin** can obtain a supported, stable handle to the **browser integrated with the desktop application**. Agent browser tools being documented is not proof of a plugin transport API.
- Confirm a plugin-defined provider can supply **model inference execution**, not only register model metadata. OpenCode 2 documents `ctx.provider.transform`, but its example registers a provider that talks to a **real HTTP inference endpoint**. A browser page is not automatically an endpoint.
- If an internal loopback bridge is necessary, it must be a separately consented and authenticated local component, not a public tunnel, and must not pretend that a site exposes an official model API.
- Confirm each site's applicable terms permit the intended programmatic workflow. If not, the adapter must remain disabled; no CAPTCHA bypass, session theft or undocumented endpoint replay.

## Modules, once the gates pass

1. **OpenCode plugin host:** plugin lifecycle, integration status, provider/model visibility, commands, permissions and session identity.
2. **Browser port:** stable tab ownership, manual sign-in, approved navigation, page interaction, response capture, and explicit abort. Reuse the attached browser when supported.
3. **Conversation coordinator:** durable mapping of OpenCode session IDs to provider tabs and web conversation IDs, plus clear reset/recovery rules.
4. **Structured agent transport:** prompt framing, bounded output capture, final-turn detection, response chunk ordering, tool intent parsing/validation and tool-result return.
5. **Tool broker:** invoke only native OpenCode tools after permission checks; idempotency IDs, replay prevention, mutation confirmations and audit records.
6. **Provider adapters:** each implements the same port, while isolating selectors, completion detection, language/localization differences and feature capabilities.
7. **Testing:** synthetic browser fixtures first; browser integration and real account tests only with authorization and compliant terms.

## Delivery gates

| Gate | Acceptance |
| --- | --- |
| G0 | Name, independent public repository, license, CI and scoped architecture published. |
| G1 | Native OpenCode 2 plugin loads on exact tested version; provider runtime and browser integration points experimentally verified. |
| G2 | Deterministic browser fixture read/send/receive with tab isolation, interruption, deduplication and no secret access. |
| G3 | Real transport behind a mock local inference harness, including full/streamed responses, cancellation, errors and recovery. |
| G4 | Structured tool execution under native permissions and durable replay journal, proven with negative tests. |
| G5 | Every authorized provider adapter passes independent compatibility, security and policy reviews; only passing adapters are enabled. |
| G6 | Multi-session, worker and worktree E2E; update/reload/resume testing; reproducible installation/release. |

## Reuse strategy

Chat On Steroids: https://github.com/totec448-spec/chat-on-steroids (MIT). Review its durable agents, completion, recovery, and worker handoff contracts for selective reuse. Do not copy its browser extension or Electron backend wholesale. Any reused source must retain its license/copyright headers and be documented in `THIRD-PARTY-NOTICES.md` before incorporation.

Reference documentation: https://opencode.ai/v2/docs/build/plugins/ and https://opencode.ai/v2/docs/tools/.
