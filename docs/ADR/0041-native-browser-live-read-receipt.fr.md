# ADR 0041 — Le résultat snapshot requiert read.commit ET read.live

## Reproduction native (RED)

Sur le patch combiné G93 du commit officiel épinglé `4617210822bdbb31e5749751afbfb4584ccedac8`, un `BrowserConnection.make` réellement exécuté accepte un résultat de `snapshot` après un `read.commit` correct **sans aucun appel à `read.live`**. Le résultat page-content est livré à la demande en attente. Le test hostile émet `result(success, PRIVATE_DOC_UNCOMMITTED_LIVE)` entre le commit et la revalidation Core et s'attend à un refus ; il est RED avant la correction.

L'implémentation officielle Desktop `pane.ts` appelle normalement `startCommittedRead` → `read.live` après `page.ready` et avant l'effet Chromium. Ce contrat n'était **pas exigé par le Core sur le retour de résultat** : un ancien client Desktop, une implémentation défaillante ou un appelant qui connaît la preuve d'attachement pouvait omettre l'étape de revalidation et remettre du contenu au Core.

## Correction native bornée (GREEN)

Chaque commande de lecture à usage unique mémorise désormais un bit `live=false`. Ce bit ne devient vrai qu'après un `read.live` qui vérifie preuve V6, ticket, commit consommé, échéance, callback d'autorité Core et génération du tab. Le RPC `result` refuse et invalide irréversiblement tout résultat de lecture si le bit n'a jamais été obtenu. La demande en attente reçoit alors une erreur générique immédiatement, sans divulgation de la réponse ni attente de 60 secondes. Un ticket faux et une revalidation tardive ne ressuscitent pas l'opération.

Les nouveaux targets ne sont plus créés lorsque l'attachement est en fermeture ou non prêt ; `request` / `requestOnce` réévaluent aussi cet état avant tout dispatch. Le miroir Core-local `browser.tabs.list` conserve ses informations d'onglets et aucun nouveau droit de lecture/écriture WebBridge n'est ouvert.

## Preuves et limites

Le test adversarial RED avant / GREEN après utilise la vraie fabrique `BrowserConnection.make` avec des dépendances RPC/session simulées, pas un processus Electron. Le test positif d'une lecture native autorisée reproduit la séquence de première partie `read.commit` → `read.live` → `result`. Les refus des lectures legacy `target.request`, `target.inspect`, du `snapshot` sans reçu et des autres lectures (notamment `find`, `evaluate`, `network.get`) restent testés.

**NO-GO production inchangé :** aucun transport n'atteste la provenance du premier processus Desktop ; un client API autorisé qui s'attache en premier peut se proclamer propriétaire et, s'il détient la preuve, appeler aussi `read.live`. La nouvelle exigence est une protection de séquencement/défense en profondeur, **pas une preuve que Chromium a effectivement exécuté son contrôle**. Le Core ne possède pas d'attestation de l'effet navigateur, et la révocation Core ↔ Desktop n'est pas transactionnelle. Aucun Electron E2E officiel, ni disponibilité des cinq fournisseurs web, ni droits WebBridge `navigate/click/fill/submit` n'est revendiqué. Il faut un principal de transport vérifié avant `attach`/grant et un reçu d'exécution cryptographiquement relié à l'effet pour élever cette limite.
