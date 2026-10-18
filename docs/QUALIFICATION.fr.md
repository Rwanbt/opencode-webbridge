# Rapport de qualification (généré)

> **Document généré** par `npm run docs:qualification` — ne pas éditer à la main.
> Sources : `planning/release-posture.json`, `planning/progress.json`,
> `planning/acceptance-matrix.json`, `planning/backlog.json`. Un test vérifie que ce
> fichier reste identique à la sortie du générateur (dérive = échec). La matrice détaillée
> est dans `docs/TRACEABILITY.fr.md`.

## 1. Décision de release

| Champ | Valeur |
| --- | --- |
| Décision | `NO-GO-PRODUCTION` |
| Périmètre autorisé | CLI experimental (raw npm tarball verticals on the official OpenCode CLI 2.0.32: install/lifecycle Windows+Linux; dormant native web models; five individually consented live provider conversations demonstrated, one turn each with an UNCERTAIN terminal) |
| Desktop/Electron | `false` (non prouvé) |
| Fournisseurs commerciaux opérationnels | `5` (0/5) |
| Écritures navigateur | `false` |
| Acceptation production | `false` |

## 2. Indicateurs (inchangés sans preuve vérifiable)

| Indicateur | Valeur |
| --- | --- |
| `productionAcceptedStoryIDs` | `[]` |
| `commercialProvidersOperational` | `[chatgpt, deepseek, gemini, qwen, mistral]` |
| `nativeDesktopElectronE2E` | `false` |
| `atomicCoreChromiumRevocation` | `false` |
| `commercialAutomationAuthorized` | `false` (métadonnée historique) |
| `webbridgeWritesEnabled` | `false` |

## 3. Bloqueurs de release

| ID | Statut | Preuve |
| --- | --- | --- |
| `desktop-electron-e2e` | NOT-PROVEN | G111 preflight NO-GO (PR #188) + public-CLI authority probe on 2.0.32 (PR #226): no official Electron browser API; Desktop E2E never inferred from lo… |
| `atomic-core-chromium-revocation` | NOT-PROVEN | race window during Chromium execution documented; pre-effect revalidation alone cannot eliminate it |
| `native-effect-wiring` | BLOCKED-UPSTREAM | NativeEffectAuthority interface absent from the official OpenCode public API; 2.0.32 language hook carries no session identity either (upstream propo… |
| `provider-completion-and-session-coverage` | NOT-PROVEN | one verified real conversation per provider, but no completion proof exists (terminal UNCERTAIN), and login/logout, multi-turn and error coverage are… |
| `production-acceptance` | NOT-PROVEN | 0/54 stories production-accepted; L3 requires a real authorized external interaction proven at the exact level |

Bloqueurs techniques enregistrés dans `planning/progress.json` : **6** — Desktop non attesté, révocation Core→Chromium non atomique, effets incertains post-crash, Git/terminal/sous-agents natifs, cinq transports web réels non vérifiés, Electron E2E manquant.

## 4. Acceptation des stories

- Niveaux : **L0** 0 · **L1** 42 · **L2** 12 · **L3** 0
- Stories au total : **54** (9 épics E0–E8)
- Stories acceptées production : **0/54**
- L3 acceptance requires verified real user-initiated web-provider conversations or official Desktop Electron E2E at the exact level; no fixture or lower-level evidence may count. Enforced at 0/54.

## 5. Base de preuves

- preuves partielles enregistrées : **125** (fenêtre couverte exactement une fois, vérifiée par `npm run check:progress`)
- rouges superseded pinnés (SHA + motif) : **11**
- dernier SHA vérifié enregistré : **PR #277** @2fb7334a6106fd84668d8becbf1e51101a011d4e (38 checks, périmètre `generated-traceability-matrix-partial`)

## 6. Inventaire de la vague (#258+, PR Draft, aucune fusionnée)

| PR | SHA | Checks | Périmètre |
| --- | --- | --- | --- |
| #258 | `5a75d076e46b4d5fc56eef009559bc77d4689944` | 38 | `official-cli-2032-vertical-windows-partial` |
| #259 | `683b5f133ef8f1c8b5693dbd05f98194af16458f` | 38 | `package-lifecycle-uninstall-partial` |
| #260 | `a7a1cc4eb1f0390b0e0e5a049ed5438b0d7ea786` | 38 | `provider-module-contract-partial` |
| #261 | `45f1b4f2ea054c1f62cd6c45a9f1c0145d8ec29a` | 38 | `native-web-models-served-partial` |
| #262 | `f79fb05a0adef8261ac643855d6b8179b759da33` | 38 | `consented-browser-turn-anti-replay-partial` |
| #263 | `34e30ba0f85e9aabdc7992fa9610b716c7ad0a97` | 38 | `consented-declared-tab-wiring-partial` |
| #264 | `cbbb7363a4fa6f70f6716796db5c11c22af1f2f0` | 38 | `evidence-review-window-142-263-partial` |
| #265 | `2632298780b554604f6a5926c724aa9ab8e43d6c` | 38 | `five-provider-adapter-registry-partial` |
| #266 | `800fdeb303ae09317dcd3a57e2e5b6861e3450c8` | 38 | `transport-invariants-offline-proof-partial` |
| #267 | `5b0c7c0936d8ee4f3db3d441d07964087be95c3a` | 38 | `durable-progressive-delivery-partial` |
| #268 | `a3eff15acaa68826fcf8a9313621d81d52dc4285` | 38 | `tab-scope-identity-operator-reconciliation-partial` |
| #269 | `9ac0ccac7c820b37f077964f905148a820cc0b2f` | 38 | `native-governance-budget-redaction-partial` |
| #270 | `dab42454719010594d0fedddcd30163a5259aeb1` | 38 | `native-turn-limits-security-matrix-partial` |
| #271 | `c38e32aa27fdef39816032c1163d2c95fc7a5e35` | 38 | `verifiable-refusal-catalogue-partial` |
| #272 | `f170a5485f7922156f3f019f44b79bca3702da91` | 38 | `readonly-workspace-tools-partial` |
| #273 | `9cabb5862a4ceff60202f501ccd7c6b026226348` | 38 | `subagent-identity-isolation-partial` |
| #274 | `795c7aec3b5771923921622280979c9ae055bb11` | 38 | `durable-history-bounded-wait-partial` |
| #275 | `df05d70593ef603ba0764784e2737b05629535b1` | 38 | `desktop-four-level-qualification-partial` |
| #276 | `631567b28c8b1d0baa1bc7a7df015d39ec10fd9f` | 38 | `install-guide-changelog-packaging-contract-partial` |
| #277 | `2fb7334a6106fd84668d8becbf1e51101a011d4e` | 38 | `generated-traceability-matrix-partial` |

## 7. Capacités prouvées / non prouvées

**Prouvées sur la surface installée (L2, 12) :** US-E1-01, US-E1-02, US-E1-04, US-E1-05, US-E2-05, US-E2-06, US-E6-01, US-E6-02, US-E8-01, US-E8-02, US-E8-03, US-E8-04

**Implémentées hors surface installée (L1, 42) :** US-E0-01, US-E0-02, US-E0-03, US-E0-04, US-E0-05, US-E0-06, US-E1-03, US-E1-06, US-E2-01, US-E2-02, US-E2-03, US-E2-04, US-E3-01, US-E3-02, US-E3-03, US-E3-04, US-E3-05, US-E3-06, US-E4-01, US-E4-02, US-E4-03, US-E4-04, US-E4-05, US-E4-06, US-E5-01, US-E5-02, US-E5-03, US-E5-04, US-E5-05, US-E5-06, US-E6-03, US-E6-04, US-E6-05, US-E6-06, US-E7-01, US-E7-02, US-E7-03, US-E7-04, US-E7-05, US-E7-06, US-E8-05, US-E8-06

**Acceptées production (L3, 0) :** aucune — voir les consentements requis.

Non revendiqué : conversation web authentifiée des cinq fournisseurs (0/5), exactly-once bout-en-bout, reprise sur session fournisseur réelle, Desktop/Electron packagé, cœur patché, attestation d'identité OS.

## 8. Consentements requis (avant toute conversation web réelle)

- P0 — une session ChatGPT réelle autorisée : profil Chrome/Chromium dédié (port CDP 9222), un onglet `chatgpt.com` déclaré, un seul envoi de test.
- Adaptateurs live des cinq fournisseurs — les mêmes sessions authentifiées, déclarées onglet par onglet (ChatGPT, DeepSeek, Gemini, Qwen, Mistral Le Chat).
- Desktop/Electron packagé — une API publique d'installation d'extension (aujourd'hui refusée en mode packagé) et un profil Desktop jetable.

Aucune autorisation commerciale générale n'est exigée : l'activation est individuelle (choix utilisateur, session accessible, capacités prouvées, permissions, règles fournisseur, sécurité).
