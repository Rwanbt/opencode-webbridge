# ADR 0043 — Un seul `read.live` et aucune restitution après expiration

**Statut :** proposition de correctif sur OpenCode V2 officiel `4617210822bdbb31e5749751afbfb4584ccedac8`. **NO-GO production WebBridge.**

## Défaut démontré

Le RPC `experimental.browser.read.live` était validé plusieurs fois avec les mêmes `sessionID`, `connectionID`, preuve d'attachement, `requestID` et ticket tant que le bail restait valide. De plus, la validation de `result` vérifiait `read.live` et la politique, mais omettait la date d'expiration de ce même bail. Un résultat contenant la page pouvait donc être accepté **après le délai de 5 secondes** tant que les autres états restaient inchangés. Un reçu de pré-effet était ainsi réutilisable et sa durée ne bornait pas la restitution.

## Correctif

Dans `packages/plugin-browser/src/connection.ts`, `read.live` conserve la revérification de l'époque et de la génération de l'onglet, puis retourne `false` si ce reçu a déjà autorisé une exécution. Il ne remet jamais `live` à zéro. Le traitement du résultat exige aussi `performance.now() < read.expires` avant de résoudre le résultat. Une restitution tardive échoue, invalide définitivement le commit et provoque l'échec du tool en attente. L'inventaire `browser.tabs.list` ne change pas ; aucune capacité d'écriture WebBridge n'est ouverte.

## Preuves exécutables

- Deux nouveaux tests dans le **vrai** `packages/plugin-browser/test/read-commit.test.ts` : second `read.live` identique refusé, et réponse contenant une page après expiration refusée avec échec du lecteur. Une horloge Bun contrôlée rend le cas d'expiration déterministe, sans attente de cinq secondes.
- **RED** avec les nouveaux tests avant correction : `14 pass, 2 fail`, montrant un second `read.live === true` et un résultat expiré accepté.
- **GREEN** après correction : `16 pass, 0 fail`, `70 expect()`, exécutés sur une copie isolée du commit officiel, avec `bun test test/read-commit.test.ts` depuis `packages/plugin-browser`.
- Correctif combiné régénéré depuis le commit exact, `git apply --check` puis `git apply` sur une seconde copie vierge du même commit ; `git diff --check` réussi. CI Linux de la PR Draft sur SHA de tête à contrôler séparément.

## Limites

Le reçu est à usage unique côté Core, mais aucune identité de processus Electron n'est prouvée par `attachmentProof` fourni par l'appelant RPC. Un acteur pouvant attacher le premier reste un risque non résolu. La révocation Core juste après la réponse à `read.live` ne peut empêcher atomiquement un accès à Chromium déjà lancé dans un autre processus. Une expiration après invocation n'annule pas les octets déjà lus par Desktop ; elle en empêche uniquement la transmission comme résultat de l'outil. Un snapshot légitime qui met plus de cinq secondes entre sa mise en file et son résultat est désormais refusé et devra faire l'objet d'une nouvelle autorisation. Les tests locaux démontrent le comportement Core, **pas** un parcours Electron packagé ni les fournisseurs commerciaux. L'installation officielle du Desktop et l'amont OpenCode restent inchangés.
