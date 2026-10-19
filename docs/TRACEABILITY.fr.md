# Matrice de traçabilité (générée)

> **Document généré** par `npm run docs:traceability` — ne pas éditer à la main.
> Sources : `planning/backlog.json`, `planning/acceptance-matrix.json`,
> `planning/issue-map.json`, `planning/progress.json`. Un test vérifie que ce fichier
> reste identique à la sortie du générateur (dérive = échec).

## Indicateurs (état exact, non modifiés sans preuve vérifiable)

| Indicateur | Valeur |
| --- | --- |
| `productionAcceptedStoryIDs` | `[]` |
| `commercialProvidersOperational` | `[chatgpt, deepseek, gemini, qwen, mistral]` |
| `nativeDesktopElectronE2E` | `false` |
| `atomicCoreChromiumRevocation` | `false` |
| `commercialAutomationAuthorized` | `false` (métadonnée historique) |
| `webbridgeWritesEnabled` | `false` |

Niveaux : **L0** absent · **L1** implémenté/vérifiable hors surface installée · **L2** vérifié sur la surface installée en CI au SHA exact · **L3** accepté production (session web réelle déclenchée par l'utilisateur, jamais déduit d'une fixture).

## Synthèse par épic

| Épic | Titre | Issue | Stories | L0 | L1 | L2 | L3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E0 | Governance, decisions and service compliance | #4 | 6 | 0 | 6 | 0 | 0 |
| E1 | OpenCode 2 native plugin and inference runtime | #5 | 6 | 0 | 2 | 4 | 0 |
| E2 | Integrated browser driver and account sessions | #6 | 6 | 0 | 4 | 2 | 0 |
| E3 | Conversation transport, structured tools and recovery | #7 | 6 | 0 | 6 | 0 | 0 |
| E4 | Security, isolation and privacy | #8 | 6 | 0 | 6 | 0 | 0 |
| E5 | Provider adapters and validation | #9 | 6 | 0 | 6 | 0 | 0 |
| E6 | Native user experience and operations | #10 | 6 | 0 | 4 | 2 | 0 |
| E7 | Projects, workers and multi-agent execution | #11 | 6 | 0 | 6 | 0 | 0 |
| E8 | Quality, releases and maintenance | #12 | 6 | 0 | 2 | 4 | 0 |
| **Total** | | | **54** | **0** | **42** | **12** | **0** |

## E0 — Governance, decisions and service compliance

_Architecture, permissions and independent provider policy decisions grounded in evidence_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E0-01 | P0 | #13 | L1 | docs/ADR 0001-0068 decision log + docs/ARCHITECTURE.md; no automated link-validation test |
| US-E0-02 | P0 | #14 | L1 | planning/provider-policy-review.json (dated audit) + check:policy gate wired in CI |
| US-E0-03 | P0 | #15 | L1 | THIRD-PARTY-NOTICES.md + LICENSE |
| US-E0-04 | P0 | #16 | L1 | docs/ARCHITECTURE.md trust boundaries + ADR 0003 (transactional browser grant TCB); review checklist not automated |
| US-E0-05 | P1 | #17 | L1 | planning/backlog.json + issue-map.json + progress.json; check:backlog/check:progress gates in CI |
| US-E0-06 | P1 | #18 | L1 | per-provider go/no-go in the policy review + provider-policy and provider-policy-review tests |

## E1 — OpenCode 2 native plugin and inference runtime

_Loadable plugin plus demonstrable model execution using a deterministic fixture_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E1-01 | P0 | #19 | L2 | raw npm tarball installed into disposable official CLI 2.0.32 profiles; plugin active in Windows + Linux CI jobs (PR #2… |
| US-E1-02 | P0 | #20 | L2 | installed-CLI fixture turn: labelled fixture answer, single durable journal entry, uncertain terminal (PR #261 @45f1b4f… |
| US-E1-03 | P0 | #21 | L1 | src/core/adapter-contract.ts + adapter-contract tests + provider-gate negative tests |
| US-E1-04 | P0 | #22 | L2 | official CLI serves webbridge-<provider>/<model> entries with explicit IDs only after individual activation, dormant de… |
| US-E1-05 | P1 | #23 | L2 | strict consent/config declarations validated (unit) plus installed-CLI refusal scenario at exact SHA (PR #263 @34e30ba,… |
| US-E1-06 | P1 | #24 | L1 | planning/compatibility.json + check:compat CI guard; coverage limited to the pinned reference, never extrapolated |

## E2 — Integrated browser driver and account sessions

_Permissioned tab/session control without credential export_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E2-01 | P0 | #25 | L1 | browser-host-capability + desktop-capability tests; G111 preflight NO-GO documented (PR #188) |
| US-E2-02 | P0 | #26 | L1 | src/core/browser-port.ts + fake-browser + browser-fixture-relay tests |
| US-E2-03 | P0 | #27 | L1 | session-binding + browser-exchange-tab-change tests (one visible tab bound to one local session) |
| US-E2-04 | P0 | #28 | L1 | fixture-auth + credential deny tests; no credential access path (secret-redactor + deny policy) |
| US-E2-05 | P1 | #29 | L2 | CI native smoke: real headless Chromium DOM settle + progressive SSE (smoke:g99-page / g119 scenarios) on exact SHA |
| US-E2-06 | P1 | #30 | L2 | CI native smoke: chromium page close during a native turn (G113/G60 scenarios) + host cleanup negative tests |

## E3 — Conversation transport, structured tools and recovery

_Replay-safe turns, complete response handling and validated tools_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E3-01 | P0 | #31 | L1 | adapter-contract + rpc-relay-port tests (one typed conversation transport) |
| US-E3-02 | P0 | #32 | L1 | browser-exchange tests + event ordering/generation identity tests |
| US-E3-03 | P0 | #33 | L1 | tool-proposal tests (strict schema, invalid envelope refusals) |
| US-E3-04 | P0 | #34 | L1 | effect-broker + effect-transaction + recovery-restart-scenarios (at-most-once, replay refused) |
| US-E3-05 | P0 | #35 | L1 | session-recovery-coordinator + durable-relay-journal + recovery-restart tests (browser reload / process crash) |
| US-E3-06 | P1 | #36 | L1 | browser-exchange-abort + disconnect + g112 uncertainty tests (timeout/cancel terminal states) |

## E4 — Security, isolation and privacy

_Auditable permission boundaries and threat-driven negative tests_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E4-01 | P0 | #37 | L1 | consent-gate + tool-broker tests; per-tab declaration consent revalidated on every read, revocation via env removal + r… |
| US-E4-02 | P0 | #38 | L1 | secret-redactor tests (stateless-detection fix 52e546f) + provider-offline-benches log redaction |
| US-E4-03 | P0 | #39 | L1 | session-binding + confused-deputy adversarial tests (cross-session disclosure refused) |
| US-E4-04 | P0 | #40 | L1 | fragment admission + tool-proposal validation; untrusted page content cannot issue commands directly |
| US-E4-05 | P0 | #41 | L1 | tunnel-guard + rate-limiter tests (hostile origin/redirect/abuse of the local bridge) |
| US-E4-06 | P1 | #42 | L1 | rate-limiter + quota/fault-injection tests (bounded work, logs and external requests) |

## E5 — Provider adapters and validation

_Five individually gated adapters conforming to a common capability contract_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E5-01 | P0 | #43 | L1 | adapter-contract tests for all five providers + provider-offline-benches against the common contract |
| US-E5-02 | P1 | #44 | L1 | ChatGPT: G159 send + G157 observer primitives, #262 durable anti-replay transport, #263 declared-tab consent with CI-pr… |
| US-E5-03 | P1 | #45 | L1 | DeepSeek offline bench + policy gate; live authenticated turn demonstrated 2026-10-19 (real answer streamed into an off… |
| US-E5-04 | P1 | #46 | L1 | Gemini offline bench + policy gate; live authenticated turn demonstrated 2026-10-19 (real answer streamed into an offic… |
| US-E5-05 | P1 | #47 | L1 | Qwen offline bench + policy gate; live authenticated turn demonstrated 2026-10-19 (real answer streamed into an officia… |
| US-E5-06 | P1 | #48 | L1 | Mistral/Le Chat offline bench + policy gate; live authenticated turn demonstrated 2026-10-19 (real answer streamed into… |

## E6 — Native user experience and operations

_Transparent configuration, model selection, status and diagnostics in OpenCode_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E6-01 | P1 | #49 | L2 | raw tarball lifecycle on official CLI 2.0.32: install, real session, uninstall, stale config inert, clean config empty,… |
| US-E6-02 | P1 | #50 | L2 | installed CLI exposes zero webbridge models until individual activation (PR #258 @5a75d076) and serves explicit-ID entr… |
| US-E6-03 | P1 | #51 | L1 | browser-exchange-tab-change + tab metadata tests; native TUI interaction test absent |
| US-E6-04 | P1 | #52 | L1 | recovery-decision + coordinator state tests (generating / awaiting consent / blocked / retry); UI snapshot tests absent |
| US-E6-05 | P1 | #53 | L1 | browser-exchange-abort cancel path + secret-canary checks; native TUI inspection parity absent |
| US-E6-06 | P2 | #54 | L1 | docs/*.fr.md + README.md + docs/INSTALL-DIAGNOSTICS.fr.md; i18n/a11y smoke absent |

## E7 — Projects, workers and multi-agent execution

_Correct tool/session ownership and safe collaboration across agents and worktrees_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E7-01 | P1 | #55 | L1 | session-binding + coordinator ownership checks; cross-session adoption refused |
| US-E7-02 | P1 | #56 | L1 | provider-offline-benches account isolation + rate-limiter admission (parallel fixture workers) |
| US-E7-03 | P1 | #57 | L1 | strict workspace-path contract + tool-broker scope checks; dedicated Git worktree integration test absent |
| US-E7-04 | P1 | #58 | L1 | session-recovery-coordinator journal + recovery-restart-scenarios (restart without lost turn identity) |
| US-E7-05 | P2 | #59 | L1 | rate-limiter + tool-broker admission/bounds tests |
| US-E7-06 | P2 | #60 | L1 | effect-broker attestation + tool-flow staged reports; worker report attribution test absent |

## E8 — Quality, releases and maintenance

_Reproducible, tested and documented releases with rollback path_

| Story | Prio | Issue | Niveau | Preuve (extrait) |
| --- | --- | --- | --- | --- |
| US-E8-01 | P0 | #61 | L2 | CI checks at exact SHA: typecheck + guards + full suite + installed CLI scenarios; e.g. PR #263 38/38 @34e30ba (runs 39… |
| US-E8-02 | P1 | #62 | L2 | CI native fixture end-to-end (real Chromium DOM/SSE/page-close) on exact SHA 46b1b74, run 39060290836 |
| US-E8-03 | P1 | #63 | L2 | CI OS/version matrix: linux native fixture smoke + windows bounded RPC job + check:compat matrix guard; no windows Chro… |
| US-E8-04 | P1 | #64 | L2 | preview:package / preview:rpc-package / preview:g97 on every run plus raw-tarball install/upgrade/rollback on official … |
| US-E8-05 | P1 | #65 | L1 | SECURITY.md + docs/INSTALL-DIAGNOSTICS.fr.md troubleshooting table + ADR index; dedicated support FAQ absent |
| US-E8-06 | P2 | #66 | L1 | check:compat refuses unknown versions/products; upstream fixture-break simulation absent |

## Base de preuves

- preuves partielles enregistrées : **125** (fenêtre couverte exactement une fois, vérifiée par `npm run check:progress`)
- rouges superseded pinnés (SHA + motif) : **11**
- bloqueurs de release : **6** (scope CLI 2.0.32, posture `NO-GO-PRODUCTION`)
- stories acceptées production : **0/54** — L3 exige une interaction web réelle autorisée par l'utilisateur (voir les phases bloquées).
