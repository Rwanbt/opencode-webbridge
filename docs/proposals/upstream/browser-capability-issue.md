# Feature request — expose the integrated browser to server plugins as a public capability

Status: **draft issue, ready to file upstream**. Not filed: this repository never touches the
upstream remote without explicit, separate authorization. Publishing this file verbatim is the
only remaining step, and it requires a human with upstream access.

## Summary

A server plugin cannot drive OpenCode's **integrated browser**. There is no public surface: a
plugin receives no browser capability, so an integration that legitimately needs to operate the
browser the user is already looking at (with the user's consent, in the session they are already
authenticated in) has exactly one option today — launch a *separate* Chrome/Chromium with
`--remote-debugging-port`. That is a worse experience and a worse security posture than reusing
the browser OpenCode already owns.

We request a **minimal, permission-gated public capability** that lets a server plugin operate a
single user-selected tab of the integrated browser, with no access to credentials and with the
same revocation guarantees as other browser actions.

## Evidence that the capability is absent (reproducible, offline)

- The published public SDK `@opencode/plugin@2.0.29` declares only the domains
  `app, host, options, permission, rpc, runtime, runtime-modules, source, source.bun,
  source.node, source.package, storage, worktree`. There is **no `browser` domain and no
  browser declaration**. Probe: `scripts/probe-plugin-browser-capability.mjs`
  (`npm run check:plugin-browser`) → `NO_PUBLIC_PLUGIN_BROWSER_CAPABILITY`.
- `Plugin.Context` has `rpc` and `permission` but **no `browser`** key. Compile-time witness:
  `type Present<Key> = Key extends keyof Plugin.Context ? true : false;`
  `{ rpc: true, permission: true, browser: false }`.
- In the **packaged Desktop** app, extension IPC is refused before any effect
  (`packagedManagerCalls: 0`, `serverPluginRenderer: false`, `nativeDesktopExecuted: false`;
  `npm run check:d01d02` → `NO_GO_PACKAGED_GUI_EXTENSION`).
- The public docs state the agent `browser` toolspace controls the Desktop-attached browser,
  which does not imply a server plugin can command it.

## Requested API (minimal)

```ts
// TS sketch — names are a suggestion; the shape and guarantees are the request.
interface Plugin.Context {
  /** Present only when the host exposes an integrated browser. */
  readonly browser?: BrowserCapability;
}

interface BrowserCapability {
  /** Enumerate only tabs the user may consent to; opaque ids, no URLs with credentials. */
  list(): Promise<readonly { tabID: string; origin: string; generation: number }[]>;
  /** Attach to ONE tab the user explicitly selects. Consent is per tab. */
  attach(input: { sessionID: string; tabID: string }): Promise<BrowserTab>;
}

interface BrowserTab {
  readonly tabID: string;
  readonly generation: number;         // bumps on reload/replacement; a stale handle refuses
  submit(request: { turnID: string; prompt: string }): Promise<void>;
  events(turnID: string, afterSeq: number): Promise<readonly TurnEvent[]>; // text | finished | cancelled
  cancel(turnID: string): Promise<boolean>;
  release(): Promise<void>;            // always possible, even after revocation
}
```

Wiring requirements:

1. **Permission-gated.** Reuse the existing `browser` action as the built-in deny rule, and add a
   plugin-scoped action (e.g. `plugin_browser`) so a grant is per plugin + per tab. Approval must
   be re-checked around every awaited step (a user can revoke while a call is in flight).
2. **No credentials.** Never expose cookies, tokens, passwords, or private endpoints. Only opaque
   identifiers and bounded turn events.
3. **Identity + generation.** A replaced or reloaded tab is detectable and refused.
4. **Honest terminal.** The capability must let a caller distinguish a proven completion from an
   unprovable one, instead of forcing it to claim success.
5. **Fail-closed.** Absent capability ⇒ the plugin must receive no facade that pretends to work.

## Acceptance criteria

- [ ] A server plugin can attach to a tab the user explicitly selected in the integrated browser.
- [ ] The action is permission-gated, revocable, and re-validated after each await; revocation
      blocks data but still permits `release()`.
- [ ] No credential material crosses the plugin boundary (audited test).
- [ ] Reload/replacement of the tab is refused via `generation`.
- [ ] The capability works in the **packaged Desktop** app, or its absence there is documented as
      a first-class public limitation.
- [ ] A plugin receives `undefined` for `ctx.browser` when the host cannot provide it.

## Non-goals

- Bypassing authentication, CAPTCHA, anti-bot controls, or provider terms of service.
- Exposing the user's whole browsing session or cross-tab data.
- Replacing the consumer-side consent/permission model of any plugin.

## Workaround available today

An external, explicitly consented CDP transport (Chrome/Chromium started with
`--remote-debugging-port=<port>` and a dedicated profile), where the user declares one tab and the
plugin attaches to that tab only. It works, but it requires a second browser instance and does not
reuse the browser OpenCode already owns. This is the gap this issue asks to close.
