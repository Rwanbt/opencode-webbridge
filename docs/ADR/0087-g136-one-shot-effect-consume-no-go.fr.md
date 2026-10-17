# ADR 0087 — Consommation exclusive avant tout effet (G136)

**Statut : correction de protocole T02, NO-GO production.** Nouveau worktree basé sur
G133 #210, aucune modification du runtime OpenCode officiel.

## Défaillance RED

Deux appels concurrents de `runAuthorizedEffect` pouvaient vérifier le même
statut `consented`, attendre chacun l'attestation native, puis **déclencher
deux fois** l'exécuteur avant que l'un d'eux passe l'opération en `executed`.
Les objets `Operation` conservés dans la map interne étaient également
retournés par référence et modifiables depuis le caller. Une attestation
post-exécution qui rejetait la Promise levait une exception non gérée et
laissait une opération consentie, théoriquement rejouable.

## Invariant GREEN

`reserved → consented → consuming → executed | uncertain`.

La transition **synchrone et exclusive** `consume()` survient après
l'attestation initiale et juste **avant** tout effet. Deux tentatives
concurrentes ne peuvent donc pas exécuter deux fois une opération.
Une fois `consuming`, les statuts `failed`/`cancelled` ne peuvent
plus masquer un effet incertain. Toutes les opérations exposées sont
gelées ; les réservations rejettent getters, champs additionnels et
timestamps incorrects. Les erreurs pendant l'attestation initiale
refusent sans effet ; après effet, une exception d'attestation ou
une expiration aboutit obligatoirement à `uncertain`, sans rejeu.

Les tests RED→GREEN couvrent concurrence, modification des reçus,
appel de getter hostile, terminalité, temps de consentement et
perte d'attestation aux deux étapes.

## Limites

Le broker est **en mémoire** : il ne possède aucun journal durable ou
lease inter-processus et n'authentifie pas un principal OS. Son nom
historique et les IDs d'opération ne signifient **pas** permission
native. Ce protocole doit être connecté à une autorité host-owned
et une transaction persistée, testée après crash, avant tout outil
effectif. `consume()` ne doit jamais être exposé directement aux
pages web ni à un RPC non vérifié. Les tests injectent seulement
une autorité simulée : le paquet distribué a `authority:null`.

Aucun navigateur commercial, aucune permission terminal/Git write ;
fournisseurs 0/5, stories acceptées 0/54, écritures WebBridge OFF.
