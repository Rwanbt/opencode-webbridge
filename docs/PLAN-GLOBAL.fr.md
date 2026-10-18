# PLAN GLOBAL — OpenCode WebBridge

Version du plan : 1.0 — 17 octobre 2026. Périmètre : OpenCode 2.x, comptes de chat web, 5 adaptateurs, aucun abonnement API requis par l'architecture cible.

## 1. Résultat attendu et preuve de livraison

L'utilisateur sélectionne un modèle web dans OpenCode, ouvre une session, formule une tâche de développement, autorise les outils nécessaires dans OpenCode et voit les messages, appels d'outils et résultats dans **la session native**. Le fournisseur web utilise une session ouverte manuellement sur son site, si ce flux est autorisé par les conditions applicables. Il existe un transport commun, et non cinq scripts de scraping divergents.

**Démonstration finale** : installation reproductible ; sélection explicite du fournisseur et du modèle réellement disponible ; session complète avec contexte/code, au moins un outil après permission, réponse en streaming, interruption, reconnexion et reprise sans réexécution d'effet ; test multi-session, sous-agents et worktree ; logs anonymisés ; documentation des restrictions fournisseur. Chacun des cinq adaptateurs a un état séparé (enabled / unavailable / blocked / unsupported), aucune promesse d'accès universel.

## 2. Périmètre

**Inclus** : plugin serveur natif et éventuelle extension TUI ; API de transport de modèle ; navigateur intégré si techniquement accessible, avec consentement ; sessions et comptes web manuellement authentifiés ; catalogue de modèles découverts/vérifiés ; entrées/sorties texte, outils structurés, journaux durables, reprise, supervision et diagnostiques ; isolation multi-session ; agents et worktrees ; 5 adaptateurs ; tests E2E et durcissement.

**Hors périmètre** : contournement des CAPTCHAs, des contrôles anti-bot, des restrictions d'usage ou de compte ; interception/copie de cookies et de tokens ; endpoints web privés non autorisés ; extraction automatisée lorsqu'elle est interdite ; émulation mensongère de modèles ou de capacités ; compilation ou remplacement d'OpenCode ; vente/revente d'accès à des comptes tiers. Les intégrations officiellement proposées par les fournisseurs peuvent coexister sans être confondues avec un chat web.

## 3. Réalité technique et décisions d'architecture

- **Fait** : `@opencode/plugin` 2 expose `Plugin.define` et les registres de fournisseurs (`ctx.provider.transform`) ; les runtimes `@opencode/ai/providers/openai-compatible` et les packages `file://` peuvent fournir une vraie exécution. Référence : https://dev.opencode.ai/v2/docs/build/plugins/ et https://dev.opencode.ai/v2/docs/providers/.
- **Fait** : l'espace `browser` des outils de l'agent contrôle le navigateur attaché à OpenCode Desktop. Cela ne prouve pas qu'un plugin de serveur puisse le commander directement. Référence : https://dev.opencode.ai/v2/docs/tools/.
- **Décision** : une *interface `BrowserPort` minimale* et un adaptateur `ModelTransport` commun, avec implémentation de test déterministe sans fournisseur réel. La découverte de disponibilité ne doit pas inscrire un modèle factice dans le catalogue.
- **Option A préférée** : driver autorisé vers le navigateur OpenCode attaché (si API publique suffisante).
- **Option B conditionnelle** : pont local authentifié, explicitement consenti, si le navigateur et le runtime n'offrent pas un passage direct. Un bridge n'est pas une API privée de site web.
- **Option C** : fournir un mode assisté/manual-only ou laisser l'adaptateur inactif si l'intégration automatisée est interdite ou techniquement non fiable.
- **ADR obligatoires** : moteur de fournisseur, navigateur, identité & session, idempotence, gestion des secrets, conformité des fournisseurs. Tout échec de faisabilité est documenté avec preuve et décision, pas caché derrière une promesse.

La première décision est [ADR-0001](ADR/0001-provider-browser-boundary.md) : séparation entre l'API de plugin, le navigateur attaché et le futur runtime du fournisseur web.

## 4. Contrat commun à tous les adaptateurs

Identité : `providerID`, `accountRef` **opaque**, `sessionID`, `tabID` si disponible, `conversationRef` opaque, `turnID` et `operationID` durables. Un `accountRef` n'est jamais un cookie/token. États : `disabled`, `needs_login`, `ready`, `busy`, `blocked`, `unsupported`, `error`. Capabilities explicites et mesurées (text input/output, image, vision, fichiers, outils structurés, streaming, stop, resume), jamais supposées. Les limites de contexte et de débit inconnues sont étiquetées **inconnues**.

`prepare` vérifie les capacités/consentements, `send` crée un tour unique, `observe` récupère des événements ordonnés avec finalization barrier, `cancel` est best effort sans prétendre arrêter le service, `reconcile` résout les tours incertains avant toute répétition. La boucle d'outils fait passer chaque `operationID` par `proposed → approved → dispatched → confirmed / uncertain / refused`, et ne réexécute jamais aveuglément `uncertain`.

## 5. Backlog et traçabilité

La source de vérité versionnée est [`planning/backlog.json`](../planning/backlog.json). Chaque ligne contient ID stable, épic, priorité, persona, user story, valeur, critères d'acceptation, vérifications, dépendances et estimation relative. `scripts/sync-github-issues.mjs` publie les épics et user stories sur GitHub de manière idempotente, et `planning/issue-map.json` référence leurs numéros.

Les trois issues initiales (#1, #2, #3) sont conservées comme jalons de preuve/validation :
- #1 : G1 intégration réelle du runtime provider et du browser attaché.
- #2 : G2 fixtures et protocole d'outils rejouable.
- #3 : G5 matrice multi-fournisseurs et conformité.

### Épics

| Épic | Domaine | Objectif de sortie |
| --- | --- | --- |
| E0 | Gouvernance, ADR, conformité | Choix prouvés et droits/attributions exacts |
| E1 | Hôte plugin & provider natif | Chargement/déchargement et runtime de modèle de test éprouvés |
| E2 | Navigateur & session web | Accès contrôlé, onglet isolé, login manuel et états explicites |
| E3 | Transport & outils | Tours cohérents, streaming, protocole validé, idempotence |
| E4 | Sécurité & confidentialité | Contrôles négatifs, secrets et permissions protégés |
| E5 | Adaptateurs des 5 fournisseurs | Portabilité réelle derrière gates contractuelles et techniques |
| E6 | UX / TUI / exploitation | Sélection, statut, support et dépannage transparents |
| E7 | Multi-agents & projets | Isolation, handoff, worktrees et limites de coût |
| E8 | QA, CI, packaging, release | Tests multi-OS, installation vérifiée, artefacts traçables |

## 6. Gates et ordre de réalisation

| Gate | Prérequis et preuve obligatoire | Blocage si échec |
| --- | --- | --- |
| T0 | Repo propre ; licences, threat model, CI, backlog ; SDK/OpenCode versions enregistrées | Pas de portage réel |
| T1 / G1 | Plugin V2 réellement chargé sur OpenCode 2.0.29 ; test moteur d'inférence avec fixture ; browser capability explorée sans secret | Pas d'annonce « fournisseur natif » |
| T2 / G2 | BrowserPort mock + tours/cancel/reprise, isolation et effets idempotents validés en CI | Pas de navigateur réel |
| T3 | Consentement, permissions, injection, logs et secret handling audités, protocole d'outils complet | Pas d'action externe |
| T4 / G5 | Adaptateurs validés séparément techniquement, juridiquement et par tests sur comptes explicitement autorisés | Adaptateur demeure `disabled` / `unsupported` |
| T5 | E2E sessions/agents/worktrees, compatibilité Win/macOS/Linux, documentation d'installation et rollback, release signée si applicable | Pas de release stable |

Une gate ne peut pas être cochée grâce à une simple implémentation mock lorsque le critère exige un navigateur ou compte réel. Un test de simulation fournit une preuve sur les contrats et non sur les conditions d'utilisation du service.

## 7. Sécurité / privacy / modèle de menace

Frontières de confiance : compte web et page tierce, navigateur attaché, plugin, transport local, session OpenCode, outils OS et Git. Les menaces prioritaires sont : vol d'identifiants, fuite inter-compte/onglet, injection depuis le DOM, confusion de rôle agent/outil, prompt/tool replay, erreur de propriétaire d'un résultat, SSRF/CSRF local, journaux contenant secrets, surcharge CPU et quota externe. Défenses : allowlist explicite des origines, pairage par nonce/capability et boucle locale, pas de cookies accessibles au plugin, schémas stricts, consentement/outillage natif, journal append-only des opérations, refus par défaut et tests d'attaques.

**Séparation** : autorisation du navigateur ≠ autorisation d'un outil OS ; abonnement web ≠ autorisation d'automatisation ; réponse du modèle ≠ commande de confiance ; possession d'un onglet ≠ accès à toutes les conversations du compte.

## 8. Stratégie de test et qualité

Pyramide : tests unitaires des contrats/permissions, simulations d'interfaces (sans Internet), tests intégrés transport local sous OpenCode exact, E2E navigateur permis et supervisé, matrice par fournisseur/OS/langue. Chaque régression comporte un test RED puis GREEN et une reproduction. Pas de tests faussement positifs fondés sur un seul snapshot. Pipeline Linux + Windows, provenance/dépendances/secret scan, version SDK épinglée, builds reproductibles et dépendances revues.

## 9. Gouvernance de contribution

Branches fonctionnelles, PR petites et reviewables (objectif <=400 lignes de code source par PR), tests adaptés, commentaires sur risques et migrations, pas de merge avec CI rouge. `main` reste stable ; pas d'actions externes sur les comptes en tests automatiques. Critères de DoD : story traçable, code + tests négatifs, TypeScript strict, CI au SHA exact, documentation et sécurité mises à jour, revue ; si un critère dépend d'un tiers, statut `blocked` explicite.

## 10. Livraison

Sorties : plugin local/npm selon l'API prouvée, configurations d'exemple sans secrets, UI de statut, diagnostics expurgés, guides FR/EN, matrice de capacités réelle, notes de changement, documentation de sauvegarde/export et procédure de retrait désactivant le bridge. Versions semver ; zéro promesse de maintien si un fournisseur modifie ou interdit l'automatisation.

## 11. Premier lot effectivement implémentable

Avant tout site réel : fixer les contrats de capacités et de statuts des fournisseurs, interdire l'activation tant que la conformité/transport n'est pas prouvée, les tester, et effectuer un spike de chargement du plugin et du navigateur sur 2.0.29. Dépendances : E1 et E2 ; tickets #1 et #2 restent prioritaires.
