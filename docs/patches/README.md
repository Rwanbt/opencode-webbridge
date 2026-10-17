# Upstream OpenCode V2 — optional read-only browser capability

**Proposal:** [`opencode-v2-4617210-browser-plugin-capability.patch`](./opencode-v2-4617210-browser-plugin-capability.patch)

**Exact base:** official [`anomalyco/opencode` V2 `4617210822bdbb31e5749751afbfb4584ccedac8`](https://github.com/anomalyco/opencode/commit/4617210822bdbb31e5749751afbfb4584ccedac8). Apply **only** to that commit; this is an upstream patch proposal, not installed WebBridge code. Parent WebBridge PR: [#78](https://github.com/Rwanbt/opencode-webbridge/pull/78).

Patch SHA-256: `6A3716287E43AFE3676A72CD12BA00BF8C32EC0624BB3D7E139B64331FDC0793`.

Follow-up to #110: [ADR 0004](../ADR/0004-core-permission-browser-read-epoch.md) adds a real, read-only `Permission.Service.browserRead` authority with policy-version invalidation and RED→GREEN Core integration tests. This ledger is **not invoked by Desktop or existing browser tools**, and cannot grant native writes.

Independent hostile E2 follow-up to #114: permission-hook registration/removal now increments a synchronous revision observed by `browserRead` before issuance and consumption. Public Agent getters return detached snapshots so callers cannot silently mutate the Agent State permissions that underpin its revision. Two live Permission.Service regressions were RED on #114 and GREEN with the fix; other mutable hook closure changes, caller provenance and the Desktop effect boundary remain explicitly uncertified in ADR 0004.

Further isolated security follow-up to Draft #120: `Permission.Service.browserRead` now requires a **fresh interactive consent request for the exact scoped `browser_plugin` resource**, even when a previously saved or configured wildcard says `allow`. It preserves configured/hook denials and sets `save: []`; replying `always` cannot save future approvals. Existing generic `Permission.Service.assert` behavior is unchanged. A real Saved wildcard race test was RED before the fix (completed without emitting any `Permission.Event.Asked`) and GREEN afterward. This remains a Core reference, without Desktop consumption or write effects.

The next stacked Draft adds the **Core-only BrowserLease reference contract** and adversarial tests. Its non-integrated nature and the missing atomic Desktop grant consumption are recorded in [ADR 0003](../ADR/0003-v2-transactional-browser-grant-tcb.md). **No native read/write dispatch uses this new ledger yet**; prior `snapshotOnce` is unchanged.

Independent E2 follow-up: the Core reference ledger now snapshots the entire validated binding **before** asynchronous authorization, refuses mutation during the await, and preserves spent-call tombstones through `revoke()` to prevent replay of the same call in a later epoch. Tickets use a bounded monotonic lifetime. Regression tests exercise forged plugin/session/action mutation, post-revoke replay, and clock rollback; the ledger remains disconnected from Desktop and **does not authorize writes**.

An additional [one-shot read authority proposal](./one-shot-read-authorization.md) is stacked on #84. It pins a live Core tool turn, trusted plugin generation, workspace, Desktop attachment, tab generation and exact read action. **Only this new snapshotOnce path is one-use; the older read methods are not.** Its limitations and reasons to withhold native writes are recorded separately.

## Problem and proposal

V2 already ships a browser under `packages/plugin-browser` and the desktop GUI extension. It exposes the `browser` Code Mode tools but does not offer third-party server plugins a public `ctx.browser` contract. The published WebBridge SDK `@opencode/plugin@2.0.29` also lacks that property. The proposal adds to both Promise and Effect plugin contexts:

```ts
const tabs = await ctx.browser.tabs({ sessionID })
const page = await ctx.browser.snapshot({ sessionID, tabID: tabs[0].id })
// page: { content: string, truncated: boolean } — untrusted page text
```

The API is deliberately **read-only**. There is no navigate/click/fill/evaluate, credential/cookie/token access, download or network proxy capability, authentication sharing, or implicit tab selection. It uses the existing first-party `BrowserConnection`, tab generation/ownership checks and desktop session binding. The original Code Mode tool namespace, tools and permissions are unmodified.

The `PluginBrowser` core broker binds the caller ID and checks a trusted **function identity** recorded by the internal browser loader. Plugin `source` metadata, including a missing value or a forged `builtin`, grants no authority. The broker allows only that actual internal `opencode.browser` generation to register its driver. Each read checks the existing `browser` permission and requests `browser_plugin` permission for the exact `pluginID:tabs.list` or `pluginID:snapshot` resource; both checks are repeated after asynchronous grants so common revocation races fail closed. The absent/unloaded/replaced host fails closed. These checks are **not an atomic permission lease**.

The native `BrowserConnection.attach` also validates both the session's `directory` and `workspaceID` against the plugin host location. A workspace using the same directory cannot borrow another workspace's Desktop attachment. Desktop implementation source paths: `packages/gui-extensions/src/browser/main.ts` provides the `browser.pane` IPC, `renderer.tsx` sets up the model only on desktop, and `connection.ts` registers the per-session pane. These are **source-level registration proofs**, not a live GUI/browser integration test.

## Validation and limits

An independent E2 review reproduced **three failures before correction**: a fabricated `opencode.browser` generation with absent source registered a false driver; `browser_plugin` revocation during a pending `browser` recheck still executed the read; and Desktop RPC attachment accepted a different `workspaceID` sharing the same directory. Each has an upstream regression test passing after correction. Typechecks for `packages/plugin`, `packages/plugin-browser` and `packages/core` and focused capability, Promise, browser RPC and PluginSupervisor tests passed locally. The original full browser test run on Windows had **42 pass, 2 fail** in untouched `test/tunnel.test.ts` TCP half-close and HTTP proxy tests; these network failures were not attributed to the patch. CI re-fetches the exact upstream SHA and tests patched source on Linux.

No actual desktop browser, network account, or service chat was accessed during this patch's tests. The host-side grant and revocation require independent security review before this is proposed to upstream or integrated into WebBridge. In particular, browser snapshots may contain sensitive page text; the caller must treat it as untrusted input and a disclosure boundary. Whether a web-chat provider permits this integration is a separate decision.

### Blocker for the next native read/write contract

This remains a **Draft proposal only**. The existing `Permission.Service.assert` does not issue a browser-host-verifiable, single-use lease bound to an authenticated **session, assistant turn, caller plugin, Desktop attachment/generation, tab and action**. The proposed `sessionID` is supplied by the plugin. Current rechecks may require a second user permission prompt when a rule has effect `ask`; they narrow observed races but do not close the final interval between permission checks and dispatch. A new native `click`/`fill`/`submit`/`navigate` API without this lease and a host-side consumption boundary could run after revocation or be replayed after an uncertain outcome. Such a write API is deliberately **not proposed or activated** here. Next upstream contract review should first introduce a one-shot grant with explicit user consent, nonpersistent scope, revocation and browser/turn provenance, and negative tests of cross-session calls, reconnects and interrupted permissions. No commercial provider call is part of those tests.

## Reproduce

On a clean checkout of the stated upstream commit:

```sh
git apply --check /path/to/opencode-v2-4617210-browser-plugin-capability.patch
git apply /path/to/opencode-v2-4617210-browser-plugin-capability.patch
bun install --frozen-lockfile
bun run --cwd packages/plugin typecheck
bun run --cwd packages/plugin-browser typecheck
bun run --cwd packages/core typecheck
bun test --cwd packages/core test/plugin/browser-capability.test.ts
bun test --cwd packages/core test/plugin/promise-tool.test.ts test/plugin/supervisor.test.ts
bun test --cwd packages/plugin-browser test/connection-location.test.ts test/rpc.test.ts test/tools.test.ts
```

The patch file and its associated CI checks are the reviewable upstream proposal. Merging this WebBridge PR does not modify or release the official OpenCode repository.
