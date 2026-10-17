# ADR 0027 — Réserver l'attachement navigateur jusqu'au retrait de son grant

## Défaillance reproductible

Dans le patch officiel épinglé `4617210822bdbb31e5749751afbfb4584ccedac8`, `BrowserConnection.attach` acceptait un deuxième client RPC déjà autorisé à joindre l'API, sans autorité vérifiée sur le processus Desktop. Ce client créait son propre `attachmentProof` V6, déplaçait l'attachement A avec `close(sessionID, "replaced")`, ajoutait une autorisation `browser:*` à la session, puis publiait un nouvel état avec sa propre preuve. Un RED exécuté contre le vrai `BrowserConnection.make` a produit `resultA="replaced"`, `activeBrowserAllow=true`, `forgedStateAccepted=true`. Ce test utilise des interfaces session/RPC simulées, pas un véritable processus Electron.

## Correction native bornée G74

Un `attach` V6 refuse désormais toute session déjà réservée, y compris un premier `grant` encore en attente. La vérification et la réservation sont réalisées sans `await` intermédiaire. `close` révoque immédiatement l'état prêt et ferme les tunnels, mais la réservation n'est libérée qu'après la finalisation du grant. Le premier processus ne peut donc perdre sa session au profit d'une preuve créée par un autre client, et un attachement suivant ne peut démarrer pendant le retrait asynchrone de la permission précédente. Un `close` pendant l'initialisation interdit aussi une activation tardive.

Si une règle `browser:*` explicite existait déjà, le grant temporaire ne la réécrit ni ne la retire. Les règles temporaires créées par le plugin sont retirées à la fermeture lorsque l'appel de mise à jour de session aboutit. Tests du vrai `BrowserConnection.make` : tentative de remplacement avec preuve différente, session grant suspendu, permission préexistante, retrait asynchrone bloqué et refus du tunnel sans attachement actif. Les 57 tests locaux ciblés passent avec le typecheck du package `plugin-browser`.

## Limites NO-GO et mesure indispensable suivante

**Le premier `attach` n'est toujours pas une attestation du processus Electron.** Un client API autorisé qui arrive avant le Desktop peut encore se déclarer propriétaire, modifier l'autorisation de session et utiliser `tunnel.*` avec sa preuve auto-générée. Les RPC `tunnel.*` sont nécessaires au proxy réseau officiel du Desktop ; les supprimer casserait sa navigation. La protection G74 limite le remplacement et les courses de grant, sans rendre le premier attachement digne de confiance.

La correction complète exige une preuve de provenance du caller émise par un transport Desktop fiable, vérifiée côté serveur avant toute réservation/grant/tunnel, liée à la session, workspace, génération et connexion RPC, puis invalidée à la fermeture. Les seules clés `connectionID`/`attachmentProof` apportées par l'appelant ne suffisent pas. Les règles de session non étiquetées n'offrent pas une propriété transactionnelle du grant en cas de mises à jour concurrentes externes ou de défaillance d'écriture; ces situations nécessitent une mutation atomique/versionnée dans Core. Aucun E2E Electron, aucune attestation de processus, aucune garantie de révocation Core ↔ Chromium atomique, aucun write WebBridge, aucune automatisation commerciale et aucun statut production-ready ne sont revendiqués.
