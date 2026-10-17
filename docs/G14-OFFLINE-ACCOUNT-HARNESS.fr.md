# G14 — Banc d'essai hors ligne : comptes et propriété des sessions

`src/testing/offline-account-adapter.ts` simule les cinq profils de la matrice de la [PR #77](G8-PROVIDER-POLICIES.fr.md). **Aucune connexion web, authentification, lecture DOM, collecte d'identifiants ou automatisation fournisseur n'est effectuée.** Le module n'est pas importé par le point d'entrée du plugin. Un état fictif « connecté » n'est jamais une preuve d'autorisation.

- `claim` / `release` réservent localement le couple onglet/session avec `providerID` et `accountRef` opaques ; une autre identité est refusée.
- `observe` injecte uniquement des événements de fixture. L'ordre des sources est `fixture-ui` > `fixture-dom` > `fixture-cache` **entre états bloquants** ; un blocage même issu du cache l'emporte sur une simple hypothèse de connexion. Révisions strictement croissantes par source ; une déconnexion explicite (`signed-out`) ou une expiration (`expired`) révoque le bail jusqu'à sa libération et nouvelle réservation.
- `inspect` annonce les obstacles de session ; après un signal de connexion, les cinq fournisseurs sont encore refusés par la matrice ToS et `assessAdapter`. Le `ProviderGate` de production n'est pas modifié.
- `openTrace` enregistre une trace *purement locale* liée à `providerID`, `accountRef`, `sessionID` et `turnID`. `trace` vérifie à chaque événement le consentement du tour ; les réponses partielles n'ont pas de valeur finale. `execute` refuse toujours toute exécution.
- `requestAbort` retourne `uncertain` après une demande d'arrêt ; seul un événement explicite `abort-confirmed` permet `confirmed`. Une expiration, un challenge ou une limite en cours de tour le marque comme incertain et interdit de le finaliser ou de le rejouer.

Vérification : `npm run typecheck`, `npm test`, `npm run check:backlog`. Aucune de ces fixtures ne qualifie l'application comme utilisable en production ni ne déverrouille une intégration web grand public.
