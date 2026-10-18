# Matrice de sécurité S01–S05 (état réel, vérifiable)

Ce document mappe chaque exigence de sécurité à son **implémentation**, à sa **preuve**
exécutable et à son **niveau de preuve**. Il ne déclare rien qui ne soit couvert par du code
et un test présents dans le dépôt.

## Niveaux de preuve (jamais interchangeables)

| Niveau | Sens | Où |
| --- | --- | --- |
| **L1** | test unitaire / fixture, exécutable partout | `test/*.test.ts`, `npm test` |
| **L2** | plugin installé depuis le **tarball npm brut** dans la CLI OpenCode officielle 2.0.32 | jobs CI `D01`, `G125`, `G130`, `G152`, `G153`, `G168`, `G173`, `Windows raw npm tarball…` |
| **L3** | cœur expérimental patché, testé séparément | **non réalisé** (aucun patch du cœur distribué) |
| **L4** | application Desktop/Electron officielle packagée | **non prouvé** (`nativeDesktopElectronE2E=false`) |

## Matrice

| # | Contrôle | Implémentation | Preuve | Niveau | Limite honnête |
| --- | --- | --- | --- | --- | --- |
| S01 | Principal de confiance (qui agit) | `src/core/authority-context.ts` (`buildAuthorityContext`, `sameAuthority`, `isExpired`), `src/core/session-binding.ts`, `src/core/consent-gate.ts` | `authority-context.test.ts`, `session-binding.test.ts`, `consent-gate.test.ts` | L1 | Aucune attestation OS/Desktop n'est possible via l'API publique : aucune n'est simulée |
| S01 | Permissions par action + consentement explicite | `WEBBRIDGE_NATIVE_TAB_<PROVIDER>` + `WEBBRIDGE_NATIVE_JOURNAL_DIR`, `src/native/consented-transport.ts`, `src/providers/g159-chatgpt-approved-send.ts` (consommation one-shot durable *avant* tout effet UI) | `native-consented-transport.test.ts`, `g159-chatgpt-approved-send.test.ts`, scénario CLI 5 : paquet brut → CLI officiel, refus explicite + journal vide | L1 + **L2** | Le hook `aisdk:language` ne reçoit pas de `sessionID` : la permission « par tour » du cœur n'est pas atteignable (proposition upstream ouverte, PR #260) |
| S01 | Révocation en cours d'attente | `consented-cdp-attachment.ts` `stillDeclared()` relu **à chaque** point de consentement ; retrait de la déclaration = révocation immédiate | `native-consented-transport.test.ts` (déclaration modifiée/retirée → refus), scénario CLI 5 | L1 + L2 | La révocation exige un redémarrage de session pour les tentatives déjà en vol |
| S02 | Identité navigateur + onglet + génération | `src/browser/explicit-cdp-read.ts` (127.0.0.1 strict, origine du fournisseur, génération), `src/browser/cdp-document-epoch.ts`, `g157` (re-vérification target/URL/génération), `scope {tabID, generation}` enregistré et vérifié (PR #268) | `g155-explicit-cdp-read.test.ts`, `g157-chatgpt-cdp-observer.test.ts`, `g161-document-epoch.test.ts`, `native-browser-turn-transport.test.ts` (onglet déplacé / génération remplacée → `scope-changed`), `g175` (Chromium réel, CI Linux) | L1 + **L2** (Chromium Linux) | Les sélecteurs réels des quatre autres fournisseurs restent non vérifiés (`adapters-live`, bloqué par le consentement) |
| S02 | Changement de politique + anti-TOCTOU | Re-lecture de la déclaration immédiatement avant chaque effet (`approveSend`, `isStillApproved`, `approve`), re-vérification de l'époque du document avant/après chaque lecture, `src/core/effect-broker.ts` + `authority-context` (expiration, `sameAuthority`) | `effect-broker.test.ts`, `effect-transaction.test.ts`, `g159`, `native-consented-transport.test.ts` | L1 | Le TOCTOU navigateur pur (clic concurrent sur la page) reste borné par un envoi unique vérifié après coup, jamais rejoué |
| S03 | Journal anti-rejeu durable | `src/native/attempt-store.ts` (écriture temporaire + `fsync` + `rename`, corruption = refus), tentative écrite **avant** tout effet UI, `progress` (seq/longueur/digest) livré seulement après stockage (PR #267) | `native-consented-transport.test.ts`, `native-durable-progress.test.ts`, `durable-relay-journal.test.ts` | L1 + **L2** (G130 : DOM→RPC→ACK durable→SSE→redémarrage) | L'unicité « exactly-once » bout-en-bout n'est pas revendiquée : reprise = au plus une livraison par préfixe acquitté |
| S03 | Atomicité des effets | `src/core/effect-transaction.ts`, `src/core/durable-operation-fence.ts`, consommation one-shot G159 avant clic | `effect-transaction.test.ts`, `durable-operation-fence.test.ts`, `g159` | L1 | Un clic peut toujours être suivi d'une réponse incertaine : c'est traité comme tel, jamais supposé |
| S03 | États indéterminés après crash | `state: uncertain` jamais rejoué ; réconciliation explicite opérateur (`abandoned`, `bin/webbridge-journal.mjs`, PR #268) ; `src/core/recovery-decision.ts`, `src/core/session-recovery-coordinator.ts`, `src/core/reconnection-verifier.ts` | `journal-operator.test.ts`, `recovery-decision.test.ts`, `session-recovery-coordinator.test.ts`, `recovery-restart-scenarios.test.ts`, `reconnection-verifier.test.ts` | L1 + **L2** (G153 : reprise durable) | La reprise réelle sur un fournisseur authentifié reste P0 |
| S03 | Confinement d'origine + SSRF/loopback | Endpoint strict `http://127.0.0.1:<port>/` (bridge CDP, G159, opérateur d'observation, journal), origine fournisseur de `src/catalog.ts`, `src/core/provider-policy.ts`, `src/core/tunnel-guard.ts` | `g155`, `provider-adapters.test.ts` (non-loopback refusé), `provider-policy.test.ts`, `tunnel-guard.test.ts`, `native-consented-transport.test.ts` (origine non contournable) | L1 + **L2** | — |
| S04 | Anti-exfiltration de données sensibles | Le texte assistant n'est **jamais** persisté (longueur + digest seulement), l'opérateur d'observation n'imprime pas le prompt privé, `src/core/secret-redactor.ts` appliqué à chaque diagnostic natif (PR #269) | `native-durable-progress.test.ts` (journal sans texte), `native-governance.test.ts` (redaction), `secret-redactor.test.ts`, `g175` (assertion de non-fuite `PRIVATE_*`, CI Linux) | L1 + **L2** | La redaction couvre les motifs connus ; ce n'est pas une garantie exhaustive |
| S04 | Sorties DOM malveillantes / injection de prompt | Le DOM est une données non fiable : les fragments sont attribués `unverified-dom`, jamais exécutés comme instruction ; aucun chemin DOM→outil ; le prompt envoyé vient du modèle, jamais de la page | `progress-step.test.ts`, `native-browser-turn-transport.test.ts` (adoption seulement de la clé sélectionnée), `smoke-distributed-entrypoint` (`sourceContract` interdit `browser.click`/`tools`/`rpc.register` dans la racine) | L1 + **L2** | Une page hostile peut toujours mentir sur son texte : c'est pourquoi la finalité reste `uncertain` |
| S05 | Limites taille / temps / fréquence | Prompt borné (G159 4000 chars), fragments 4096, `polls`/`intervalMs`/`reconcileWindowMs` bornés, budget de tours par fournisseur + lease de concurrence (PR #269), `src/core/rate-limiter.ts` | `native-governance.test.ts`, `rate-limiter.test.ts`, `native-browser-turn-transport.test.ts` (budgets invalides refusés), `config-validator.test.ts` | L1 | Le budget est par processus et par fournisseur : un redémarrage le réinitialise (le journal, lui, reste l'autorité anti-rejeu) |
| S05 | Vérification d'intégrité / provenance des patchs | Fichiers byte-pinnés, `scripts/check-g119-cross-stream.mjs`, gardes `check:*` | `check:g119` (provenance PASS), gardes CI | L1 | — |

## Non prouvé (explicitement)

- **Desktop/Electron officiel (L4)** : aucune attestation publique vérifiable ; `desktop-capability.ts`
  ne déclare `desktopE2EProven` que si une telle attestation existe (jamais le cas ici) et `check:compat`
  rapporte `desktop NOT PROVEN`.
- **Cœur expérimental patché (L3)** : non tenté, volontairement.
- **Sessions réelles des cinq fournisseurs** : aucune conversation authentifiée n'a été exécutée ;
  `commercialProvidersOperational=["chatgpt","deepseek","gemini","qwen","mistral"]` (one verified real conversation each),
  `productionAcceptedStoryIDs=[]`.
- **Attestation d'identité OS** : impossible via l'API publique ; Basic auth HTTP n'est jamais
  considéré comme une preuve d'identité.
