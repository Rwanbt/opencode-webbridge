# Upstream OpenCode V2 — optional read-only browser capability

**Proposal:** [`opencode-v2-4617210-browser-plugin-capability.patch`](./opencode-v2-4617210-browser-plugin-capability.patch)

**Exact base:** official [`anomalyco/opencode` V2 `4617210822bdbb31e5749751afbfb4584ccedac8`](https://github.com/anomalyco/opencode/commit/4617210822bdbb31e5749751afbfb4584ccedac8). Apply **only** to that commit; this is an upstream patch proposal, not installed WebBridge code. Parent WebBridge PR: [#78](https://github.com/Rwanbt/opencode-webbridge/pull/78).

Patch SHA-256: `04EDFFC525C363875AF91993F2997855B08D83C0F52D8521AD776FF1F21FEDDA`.

## Problem and proposal

V2 already ships a browser under `packages/plugin-browser` and the desktop GUI extension. It exposes the `browser` Code Mode tools but does not offer third-party server plugins a public `ctx.browser` contract. The published WebBridge SDK `@opencode/plugin@2.0.29` also lacks that property. The proposal adds to both Promise and Effect plugin contexts:

```ts
const tabs = await ctx.browser.tabs({ sessionID })
const page = await ctx.browser.snapshot({ sessionID, tabID: tabs[0].id })
// page: { content: string, truncated: boolean } — untrusted page text
```

The API is deliberately **read-only**. There is no navigate/click/fill/evaluate, credential/cookie/token access, download or network proxy capability, authentication sharing, or implicit tab selection. It uses the existing first-party `BrowserConnection`, tab generation/ownership checks and desktop session binding. The original Code Mode tool namespace, tools and permissions are unmodified.

The new `PluginBrowser` core broker binds the calling plugin ID **and builtin provenance** from OpenCode's trusted plugin loader. Only the built-in `opencode.browser` can register a browser driver; a third-party package reusing that ID is rejected. Before each read it checks the existing `browser` permission and requests `browser_plugin` permission for the exact `pluginID:tabs.list` or `pluginID:snapshot` resource, then rechecks `browser` after the possible user prompt. The absent/unloaded/replaced host fails closed. No blanket grant is minted, and a rejected user prompt cannot be retried through the contract without another authorization decision.

## Validation and limits

Checked locally in an isolated upstream source worktree on Windows: `packages/plugin`, `packages/plugin-browser`, and `packages/core` TypeScript checks passed; capability tests 3/3 and the pre-existing Promise tool test passed. The browser RPC and tool unit tests passed. The full browser test command yielded **42 pass, 2 fail** in unrelated `test/tunnel.test.ts` TCP half-close and HTTP proxy tests on this Windows host. Those files are untouched; no conclusion about production browser networking follows from these results. The CI job checks the exact upstream SHA, applies the patch, typechecks the three packages, and runs focused tests on Linux.

No actual desktop browser, network account, or service chat was accessed during this patch's tests. The host-side grant and revocation require independent security review before this is proposed to upstream or integrated into WebBridge. In particular, browser snapshots may contain sensitive page text; the caller must treat it as untrusted input and a disclosure boundary. Whether a web-chat provider permits this integration is a separate decision.

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
bun test --cwd packages/plugin-browser test/rpc.test.ts test/tools.test.ts
```

The patch file and its associated CI checks are the reviewable upstream proposal. Merging this WebBridge PR does not modify or release the official OpenCode repository.
