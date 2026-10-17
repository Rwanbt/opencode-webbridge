# ADR 0037 — Figer le broker hôte pendant sa libération

Statut : correctif de référence **NO-GO production** — 17 octobre 2026.

## Risque et reproduction RED

`BrowserHostCapability.release()` attendait `port.release()` tout en laissant
`active=true`. Pendant cet `await`, des opérations `submit` ou `events` d'une
même liaison restaient autorisées. Si le driver était déjà en train de fermer
son onglet, des données sensibles pouvaient encore être livrées ou un nouveau
tour exécuté. Un ACK de libération perdu laissait une liaison réutilisable.

Deux tests adversariaux ont échoué avant correction : libération suspendue
permettant un autre envoi/une autre lecture, et driver qui échoue pendant la
libération sans produire d'erreur de résultat incertain.

## Décision et GREEN

- Marquer la liaison `releasing` **avant** l'appel asynchrone au driver.
- Interdire immédiatement submit, events, cancel, seconde release, claim et
  unregister tant que l'opération de libération n'est pas attestée terminée.
- Si le driver confirme, devenir inactif et permettre le retrait de l'hôte.
- Si son appel échoue, conserver le propriétaire en **quarantaine** et demander
  récupération manuelle plutôt que supposer l'onglet libéré.

Tests ciblés broker + reçus durables : **19/19 PASS** après RED, build TypeScript,
backlog et vérification diff passés localement. La conclusion CI doit être
contrôlée sur le SHA GitHub final.

## Limites

Composant de référence de WebBridge, **pas** le véritable IPC Desktop/Chromium.
Une confirmation du driver ne constitue pas une attestation OS indépendante
qu'il a effectivement libéré le navigateur. Les opérations parties avant le
début de la libération peuvent conserver une issue incertaine. Aucun effet
commercial ni écriture WebBridge n'est rendu disponible. **NO-GO production.**
