# Pull request (draft) — expose the integrated browser to server plugins

Status: **PR draft, ready to submit**. This repository never touches the upstream remote, so the
change is specified here precisely enough to implement, review and submit from a fork. It is a
*specification*, not a compilable diff, because the upstream source is intentionally not present in
this environment.

Companion issue: `docs/proposals/upstream/browser-capability-issue.md`.

## Suggested PR title

`feat(plugin): expose a permission-gated integrated-browser capability to server plugins`

## Summary

Add an optional `ctx.browser` capability to the server-plugin context so a plugin can operate a
single, user-selected tab of the integrated browser — with the existing `browser` permission as the
built-in deny rule, a plugin-scoped action, no credential access, and the same revocation
guarantees as other browser actions.

## Files / symbols to change (based on the observed public surface)

The public SDK `@opencode/plugin@2.0.29` declares the domains `app, host, options, permission, rpc,
runtime, runtime-modules, source, source.bun, source.node, source.package, storage, worktree`. The
plugin context already exposes `provider`, `tool`, `permission`, `rpc` and `aisdk`. The change adds
a sibling `browser` domain:

1. **Types** — add to the package that declares `Plugin.Context`:
   ```ts
   export interface BrowserCapability {
     list(): Promise<readonly BrowserTabInfo[]>;
     attach(input: { sessionID: string; tabID: string }): Promise<BrowserTab>;
   }
   export interface BrowserTabInfo { readonly tabID: string; readonly origin: string; readonly generation: number; }
   export interface BrowserTab {
     readonly tabID: string;
     readonly generation: number;
     submit(request: { turnID: string; prompt: string }): Promise<void>;
     events(turnID: string, afterSeq: number): Promise<readonly BrowserTurnEvent[]>;
     cancel(turnID: string): Promise<boolean>;
     release(): Promise<void>;
   }
   export type BrowserTurnEvent =
     | { readonly seq: number; readonly kind: 'text'; readonly turnID: string; readonly value: string }
     | { readonly seq: number; readonly kind: 'finished'; readonly turnID: string }
     | { readonly seq: number; readonly kind: 'cancelled'; readonly turnID: string };

   interface Context { /* … */ readonly browser?: BrowserCapability; }
   ```
2. **Host wiring** — where the plugin host builds `Plugin.Context`, populate `browser` from the
   browser manager that already backs the agent `browser` toolspace. Set it to `undefined` when no
   browser is available (packaged Desktop today, or no window) — never a facade that fails late.
3. **Permission** — reuse the existing `browser` action as the built-in deny rule on every
   data-bearing call, and add a plugin-scoped action (e.g. `plugin_browser`) so a grant is per
   plugin + per tab. Re-assert after every `await` (revocation during a pending call must be
   honoured).
4. **Identity** — expose `generation` and bump it on reload/replacement; any handle with a stale
   generation refuses.
5. **No credentials** — the bridge must not expose cookies, tokens, passwords, or private
   endpoints; only opaque ids and bounded turn events.

## Tests to add

- A type-level witness that `Plugin.Context['browser']` is optional and that the capability is
  absent when the host does not provide one (fail-closed).
- A driver test: attach → submit → progressive `text` events → terminal `finished`/`cancelled`.
- A revocation test: revoke during a pending `submit`/`events`; data must be refused and
  `release()` must still succeed.
- A generation test: reload the tab; the stale handle refuses.
- A negative test: no credential material is reachable from `BrowserTab`.
- A packaged-Desktop test (or an explicit, documented NO-GO if extension IPC stays unavailable).

## Acceptance mapping

Maps 1:1 onto the issue's acceptance criteria: user-selected tab, permission-gated and revocable,
no credentials, generation-safe, works in packaged Desktop or documents the limitation, and
`ctx.browser === undefined` when unsupported.

## Risks and non-goals

- Risk: a broad capability could widen the trust boundary. Mitigation: one tab, per-tab grant,
  post-await re-assert, no credentials.
- Non-goals: bypassing auth/CAPTCHA/provider terms; exposing the whole session; replacing any
  plugin's own consent model.

## Contributor checklist

1. Fork the upstream repository from your account.
2. Apply the type + host changes above on a feature branch.
3. Add the tests, run the project's own CI.
4. Open the PR with the title above and a body linking the issue.

Until this lands, the supported path is the external consented CDP transport (dedicated
Chrome/Chromium with `--remote-debugging-port`), which this project already implements and tests.
