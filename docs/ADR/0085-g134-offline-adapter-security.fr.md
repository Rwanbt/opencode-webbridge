# ADR 0085 — G134, durcissement hors ligne des contrats d'adaptateurs web

**Statut : durcissement de fixtures hors ligne.** Base PR #209 (`test/g130-cli-durable-ack`) commit exact `d5993f1b0950a0f1b9e5f4e9daca6bb2130a1de2`. Aucun service réel, aucun compte, aucun cookie, aucun CAPTCHA, aucune opération navigateur, aucun upstream ni Desktop modifié, aucun fichier de gouvernance (`planning/*`) modifié.

## Contexte

L'épic E5 modélise cinq fournisseurs (ChatGPT, DeepSeek, Gemini, Qwen, Mistral Le Chat) derrière un contrat déclaratif (`validateAdapterContract`, `isAdapterUsable`) et une machine à états de fixture (`OfflineAdapterSession`). L'audit G134 a montré que l'implémentation initiale lisait les propriétés par accès direct : getters hostiles exécutés, proxies déclenchés, champs inconnus/non énumérés/symboles ignorés, origines seulement préfixées par `https://`, et activation possible sur une simple déclaration `approved` sans preuve vérifiée.

## Décisions

1. **Lecture par descripteurs uniquement** (`readPlainFields`) pour tous les objets entrants : refus des proxies via `util.types.isProxy` (sans déclencher de trap), des prototypes non plats, des clés symbole, des hooks `toJSON`, des accesseurs et des champs inconnus, non énumérés ou manquants — le tout **sans jamais exécuter** le code hostile. Les bindings internes sont des copies gelées.
2. **Origines exactes du catalogue** : seule l'origine HTTPS officielle du fournisseur déclaré est acceptée ; les ressemblances (suffixe, sous-domaine trompeur, casse, slash final, query, fragment), les identifiants intégrés et les ports non standard sont refusés par des motifs distincts (`origin-mismatch`, `origin-credentials`, `origin-port`).
3. **Capacités déclarées vs vérifiées** : `capabilities` reste la déclaration, `verifiedCapabilities` porte ce qu'une fixture a réellement observé ; une vérification ne peut pas dépasser la déclaration (`incoherent-verification`). `isAdapterUsable` n'est vrai que pour un adaptateur approuvé dont les capacités cœur déclarées sont toutes vérifiées `supported` — l'activation repose sur la preuve technique et l'approbation de l'adaptateur, et aucune activation n'a lieu en l'absence de preuve.
4. **Session hors ligne** : identité de compte opaque (jamais cookie ni identifiant de connexion), isolation stricte provider/session/account/tab/connection/generation, reconnexion exigeant une génération strictement supérieure et une nouvelle connexion (aucun retour en arrière, binding périmé inerte), tours consommés définitivement jamais rejoués, fragments ordonnés et bornés (4096 octets, 16 ko, 64 fragments), terminal unique et cohérent, interruption vers `uncertain` sans faux succès ni rejeu automatique, réconciliation manuelle d'opérateur avant toute reprise, l'état de tour ne survivant ni à la reconnexion ni à la réconciliation.
5. **Preuves** : matrice adversariale commune aux cinq fournisseurs dans `test/g134-adapter-contract-hardening.test.ts` et `test/g134-offline-session-hardening.test.ts` — chaque durcissement mesuré test-first (RED avant correctif, GREEN après) ; état final : 96/96 sur la famille ciblée et 393/393 sur la suite complète, `build`, `typecheck`, `check:backlog`, `check:policy`, `check:release` et `git diff --check` verts.

## Garanties exclues

Ces fixtures n'effectuent **aucune** requête réseau, ne manipulent aucun DOM, cookie ou session réelle et n'établissent aucune capacité des fournisseurs : une fixture qui réussit n'est pas un fournisseur opérationnel. Les fichiers de gouvernance (`planning/*`) ne sont pas modifiés par ce lot ; aucun worktree, branche ou PR concurrente n'est touché. Le raccordement à un navigateur réel (transport natif, tests Desktop/E2E) relève des lots Core/Desktop suivants.
