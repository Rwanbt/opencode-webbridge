# ADR 0075 — Observation d'événements sous autorisation et checkpoint, sans effet navigateur

## Problème et portée

Le checkpoint G121 / PR #197 est désormais durable mais n'était pas raccordé
à la lecture progressive des frames. `streamBrowserTurn` fait `port.submit`,
donc son utilisation pour démontrer une simple reprise read-only pourrait
émettre de nouveau une action sur la page et créer un doublon.

## Implémentation

`observeCheckpointedRead` consomme uniquement `BrowserPort.events` pour un
tour **déjà existant** ; il n'appelle **jamais** `claim`, `submit`, `cancel`,
`release`, `navigate`, `click`, `fill` ou `submit`.

L'hôte doit fournir un hook de contrôle de lecture natif `authorizeRead`.
Une absence de hook interdit même le premier poll. Le hook est revérifié
avant et après chaque `await browser.events`, avant et après chaque ACK
asynchrone du sink. L'interface `acknowledge` doit assurer une réception
idempotente et durable pour le couple `(turnID, seq)` ; le checkpoint n'avance
qu'après l'ACK. Une réception incertaine après ACK est **tombstonée** :
pas de rejeu aveugle. Une révocation avant ACK n'expose aucun fragment.

Les frames d'une réponse sont d'abord validées en lot (identité de tour,
ordre, bornes, types, présence d'un terminal unique). Les séquences du port
sont 1-based et celles du checkpoint 0-based ; la conversion est explicite.
La reprise interroge `planRecovery` à partir du journal réellement restauré.

## Preuves runtime

- Le test fait fonctionner `BrowserPort.events`, le sink et le vrai store HMAC
  dans une même exécution Node : 3 frames reconnues, deux fragments, terminal
  durable ; reprise après restart refuse d'émettre à nouveau.
- Tests adversariaux : révocation pendant la lecture asynchrone, refus du
  sink après possible effet, révocation pendant ACK, frame d'un autre tour,
  hook natif absent et tab mal appairé. Aucun événement non autorisé n'arrive
  au sink. Aucune méthode d'effet du port n'est appelée.

## Limites / NO-GO

Le `authorizeRead` reçu est un **point d'injection** : dans le test, il est
simulé et n'est **pas une attestation de l'OpenCode Core officiel**. Ce module
n'est pas encore appelé depuis le plugin empaqueté, le CLI officiel ou
Electron. Le sink est contractuellement idempotent mais sa durabilité dépend
de l'implémentation native future. Une coupure du sink est volontairement
terminale, à réconcilier par un opérateur ; les seules reprises automatiques
admises sont des lectures déjà prouvées pures et valides. Les quotas textuels
cross-restart et la preuve de génération du processus restent à intégrer.

Ne pas considérer cette démonstration Node comme une E2E CLI/Desktop.
`navigate/click/fill/submit` WebBridge restent OFF, 0/5 commercial, zéro
story production. Pas d'OCDX, ni de modification de l'OpenCode officiel.
