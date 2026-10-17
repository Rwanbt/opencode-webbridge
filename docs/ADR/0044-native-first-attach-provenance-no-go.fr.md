# ADR 0044 — Première attache Desktop : autorité de transport requise (NO-GO)

**Décision :** patch de référence OpenCode V2 officiel au commit `4617210822bdbb31e5749751afbfb4584ccedac8` : l'attachement `experimental.browser.attach` est **refusé par défaut** tant que Core ne fournit pas une autorité de transport vérifiée. Il n'existe actuellement **aucune implémentation de cette autorité** dans le Core officiel épinglé. Proposition uniquement ; **NO-GO production et incompatibilité volontaire du Desktop standard sur ce patch de référence**.

## Défaut reproductible et preuve négative

`packages/plugin/src/effect/rpc.ts` définit `RpcCallContext` avec uniquement `error`. Dans `packages/core/src/rpc.ts`, `Rpc.Service.call` transmet à tous les handlers un contexte ne contenant que cette fabrique d'erreurs ; aucun principal de socket, identité du processus Electron, canal OS ou identifiant de plugin authentifié n'est présent. Dans `packages/gui-extensions/src/browser/pane.ts`, `attachmentProof` est une simple valeur `crypto.randomUUID()` créée par le **client** ; tout client RPC possédant l'autorisation d'appel peut en créer une autre.

Avant le correctif, le **premier** client RPC, même non attesté, pouvait réussir `attach`, injecter automatiquement `browser:* allow` dans les permissions de session et obtenir un tunnel TCP sortant (par défaut vers les destinations publiques permises, avec exceptions privées configurées par l'opérateur). Le contrôle de preuve V6 empêche l'usurpation d'une connexion déjà ouverte, mais **n'atteste jamais le premier processus**. L'API bearer et les UUID ne constituent pas une identité Electron.

## Contrat exact et refus par défaut

`BrowserConnection.make(ctx, authority?)` reçoit une capacité **interne au Core**, `DesktopAttachAuthority.verify(context, {sessionID, connectionID})`. Elle doit être fournie par un transport OS qui a authentifié de manière indépendante le processus Desktop et lie l'identité du pair à la session/connexion attendue. Le contexte RPC actuel est insuffisant pour écrire une implémentation correcte de `verify` ; le plugin officiel appelle toujours `make(ctx)` sans capacité et refuse donc toute première attache avant mutation de permission, création d'attachment, publication d'événement ou accès au tunnel.

La future intégration de cette capacité exige **au minimum** : un canal local à identité vérifiée par le système (par exemple named pipe avec ACL/jeton de processus OS sous Windows), un principal transmis **hors champs RPC du client**, un contrôle d'identité à chaque création d'attache, un lien à l'instance Core, au `sessionID`, à l'emplacement et à la connexion, une révocation à la fermeture du canal et des tests d'usurpation de pair. La capacité ne peut pas être produite en vérifiant uniquement `attachmentProof`, le mot de passe du serveur, l'ID de plugin déclaré ou un secret auto-signé. Le stub `verify: () => Effect.succeed(true)` n'existe que dans les fixtures locales pour tester les chemins hérités ; il est **interdit comme configuration de production**.

## Régressions natives et compatibilité

- **RED** : une première attache non attestée devient active dans la version précédente et ajoute `browser:* allow`, malgré un identifiant et une preuve fournis par le seul client.
- **GREEN** : sans autorité Core, la première attache échoue avec `No verified Desktop transport`, zéro `session.update`, zéro événement `attached`, inventaire de session fermé et `tunnel.open` refusé avant connexion. Un cas distinct avec capacité de test explicitement fournie conserve le comportement autorisé de `browser.tabs.list` via le miroir Core.
- Les fixtures existantes d'attachement utilisent explicitement leur fausse autorité locale ; aucune preuve de provenance Electron n'est déduite de ces fixtures. Les tests Core d'inactivité sont adaptés à l'interdiction de l'attachement non attesté.

## Risques restants et décision

Le Desktop officiel du commit V2 épinglé ne dispose pas de canal de provenance capable d'alimenter ce contrat. **Ce patch rend donc sa première attache indisponible en configuration standard** ; cela bloque aussi la liste d'onglets en production tant que l'autorité fiable n'est pas intégrée. Le chemin `browser.tabs.list` et son contrôle de permissions sont préservés lorsque l'attache est effectivement vérifiée. La fixation d'une identité de transport et la preuve d'effets Chromium, la révocation atomique Core↔Desktop, les fournisseurs commerciaux (0/5), ainsi que les écritures WebBridge demeurent **NO-GO**. Ne pas fusionner ni présenter cet incrément comme compatible avec le Desktop packagé avant implémentation et qualification du transport OS.
