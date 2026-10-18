# ADR 0018 — Révocation après attente et tombstone de l'effet déjà engagé

## Reproduction RED dynamique

Le `BrowserHostCapability` (broker expérimental, distinct du patch Electron natif) vérifiait consentement et permissions **avant** `await host.port.events(...)` et `await host.port.submit(...)`. Deux tests exécutant réellement le broker ont échoué sur le code initial :

1. Une page rendait des événements privés alors que le consentement avait été révoqué pendant l'attente. L'appel `events` retournait les données malgré la révocation (`Missing expected rejection`).
2. Un `submit` déjà entré dans le driver se terminait après révocation : le broker renvoyait un succès alors que le résultat devait être classé **incertain** (`Missing expected rejection`). Une répétition pouvait être dangereuse.

## Correctif limité et vérifiable

`events` revalide consentement, permissions natives `browser` / `webbridge_browser` et liaison active **après** le retour du driver, avant de restituer le contenu. `submit` consomme un identifiant opaque de tour **avant** l'appel asynchrone au driver, interdit les secondes soumissions du même `turnID` et revérifie les mêmes autorités après l'accusé de réception. Un échec à cette étape ne signifie pas que l'effet n'a pas été engagé : il produit `browser submit outcome uncertain: reconcile before retry`, jamais un succès ou un retry automatique. Les tombstones restent dans l'instance (maximum 1024 identifiants); leur épuisement bloque les nouveaux effets plutôt que d'effacer les plus anciens.

Tests verts sur le correctif : refus d'une lecture privée après révocation de consentement, révocation de politique/hook pendant attente, refus d'un succès tardif de soumission, impossibilité de deux envois concurrents au même tour, vérification des permissions natives après `await` et préservation du nettoyage sans consentement. Les deux tests initiaux RED ont été conservés, sans exclusion de suite.

## NO-GO

La tombstone est **volatile** : crash, rollback et réconciliation multi-processus doivent être traités par un journal durable et un broker d'effets propriétaire de l'autorité. Une révocation interprocessus juste après le dernier contrôle et avant un effet Chromium demeure possible. Ce contrôle ne qualifie pas le réel OpenCode Electron/Desktop, ne donne **aucune permission d'écriture WebBridge** et ne résout pas `attach` sans identité transport. Le résultat d'un envoi parti reste incertain jusqu'à attestation. Aucun accès à ChatGPT/DeepSeek/Gemini/Qwen/Mistral, cookies ou identifiants. **0/5 fournisseurs commerciaux opérationnels et 0 acceptation production.** Aucun merge.
