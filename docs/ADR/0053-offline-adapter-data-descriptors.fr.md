# ADR 0053 — Refus des accesseurs dans les cinq adaptateurs synthétiques

## Défaut observé

Le cycle de vie hors ligne G69 / PR #154 acceptait des objets JS dont les
propriétés étaient des getters. Lire `binding.accountRef`, `observe.signedIn`,
`progress.text` ou `reconcile.hash` pouvait exécuter le getter avant le contrôle.
Des métadonnées additionnelles sur une réconciliation n'étaient pas refusées.

## Correctif

Copier uniquement des descripteurs de données propres d'objets plats avec les
**clés exactes**, refuser symboles, prototypes particuliers, champs secrets ou
accesseurs. Vérifier les types/identités sur la copie avant de muter l'état.
Cela couvre `pair`, `observe`, `owned`, `progress`, `reconnect` et `reconcile`.
Une preuve d'opérateur de réconciliation reste une **simulation non fiable** et
ne peut jamais devenir une permission d'exécuter un effet.

## Preuves

RED pré-correctif : 5/5 nouveaux tests provider adversariaux échouent avec
`Missing expected exception`, après présentation de record avec getter.
GREEN : 20/20 tests ciblés (4 × ChatGPT, DeepSeek, Gemini, Qwen, Mistral),
build TypeScript, backlog 9 épics / 54 stories et contrôle du diff réussis.

## Limites / NO-GO

Un `Proxy` de même realm peut encore déclencher des traps pendant la réflexion
(`ownKeys`, `getPrototypeOf`) : la frontière réelle doit parser du JSON non
exécutable dans un processus isolé, et non accepter des références arbitraires.
Ce sont uniquement des **adaptateurs synthétiques**, pas une connexion à un
fournisseur commercial. Aucune extraction de cookie, aucune connexion réelle,
aucun outil, aucun test Electron ni garantie d'atomicité native. 0/5 commercial,
0 story acceptée, écritures WebBridge OFF, OCDX définitivement exclu.
