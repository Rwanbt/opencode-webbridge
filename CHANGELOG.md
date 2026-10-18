# Changelog

All notable changes to OpenCode WebBridge are recorded here.

This project has **no published release yet**: nothing below is a published version, and the
release posture stays **NO-GO-PRODUCTION** (see `planning/release-posture.json` and
`npm run check:release`). Entries are grouped under *Unreleased* and reference the pull requests
that carried them, with their verified CI state.

## Unreleased

### Installability and native models (waves 11.1 – 11.5)

- Raw npm tarball → official OpenCode CLI verticals: install, upgrade, rollback and uninstall in a
  disposable profile, with an honest provider inventory and a fail-closed operator (#258, #259).
- Native models served by the plugin through public SDK surfaces only, dormant by default and
  individually activated (#260, #261).
- Consented browser turn transport: durable anti-replay attempt record, strict attribution, no
  completion without a verified proof (#262, #263; #260 proposal upstream).

### Evidence and adapters (waves 11.6 – 11.8)

- Evidence review: verified window 142–263, hard guards against evidence substitution, three
  stories moved from L1 to L2 (#264).
- Five-provider adapter registry with single-sourced origins, plus a read-only provider
  observation operator that can never send (#265).
- Offline proof of the shared transport invariants (append-only fragments, honest terminals)
  extracted into a pure module so it runs on every platform (#266).

### Durable streaming, security, tools and Desktop (waves 11.9 – 11.13)

- Durable progressive delivery: storage-first ACK, durable delivery cursor, resume without replay
  or duplicate, `checkpoint-mismatch` refusal (#267).
- Browser scope identity (`tabID`, generation) recorded before any UI effect and verified on
  resume; explicit operator reconciliation (`webbridge-journal`, `--abandon`) for uncertain
  effects (#268).
- Security governance on the native path: bounded turn budget with a concurrency lease and
  redacted diagnostics (#269); prompt bound and validated time budgets (#270); a complete,
  test-verified refusal catalogue (#271).
- Opt-in read-only workspace tools (`file.read`, `git.status`, `git.diff`, `git.log`) with
  explicit confinement proof level, hardened Git invocation, DLP and no writes (#272); sub-agent
  safety (invoker-bound authorization, no cached grant) with the SDK limits written down (#273).
- Four-level Desktop qualification with an executable pinned-official proof and an explicit
  `NO_GO_PACKAGED_GUI_EXTENSION` verdict (#275); CI flakiness fixed at the root by a bounded
  durable-history wait (#274).

## Conventions

- Entries reference pull requests, never invented version numbers.
- A change is listed only once its CI is green at the exact final SHA recorded in the goal plan.
- Limitations and NO-GO verdicts are listed as such; they are part of the change, not noise.
