# ADR 0040 — Réparer le POST du proxy HTTP natif sans contourner le tunnel autorisé

## RED réel et diagnostic

Sous G86, `packages/plugin-browser/test/tunnel.test.ts` ignorait le POST HTTP via le proxy : réponse **502** reproductible sous Windows et en CI Linux. En réactivant le test, la version pré-correctif produit encore 502. Un journal temporaire a démontré qu'après une attache TCP autorisée, `node:_http_client` de Bun lançait son propre `fetch` vers `vps-only.invalid`, en ignorant `Agent.createConnection = () => TunnelSocket`. L'erreur `ECONNREFUSED` ne provenait donc pas du tunnel serveur. Le simple remplacement par le shim `undici.Client` ne constituait pas une solution portable. Les diagnostics et prototypes non retenus ont été retirés.

## Correction bornée G93

Le proxy Desktop conserve sa vérification Basic à temps constant **avant** toute ouverture de tunnel. Pour les requêtes HTTP directes seulement (non CONNECT/WebSocket), le code écrit maintenant les requêtes HTTP/1.1 sur le **TunnelSocket déjà ouvert par le RPC natif**, puis lit les réponses à travers ce même socket. Aucun second `fetch`, DNS, `http.request`, socket sortant ou raccourci de politique n'est créé. Les en-têtes `Proxy-Authorization` et les en-têtes hop-by-hop sont filtrés. L'URL absolue du proxy est transformée en chemin d'origine, avec le `Host` attendu.

Le décodeur de réponse borne les en-têtes à 64 Kio et les lignes à 8 Kio, rejette les statuts/framing malformés, les `Content-Length` conflictuels et les combinaisons ambiguës `Content-Length`/`Transfer-Encoding`. Il relaie les réponses par flux avec gestion de backpressure, `Content-Length`, corps jusqu'à EOF et `Transfer-Encoding: chunked` (en supprimant le framing upstream avant le rendu local). La fermeture ou l'annulation détruit le TunnelSocket ; le socket réseau n'est pas laissé actif en fin de requête.

## Preuves

Le test historique, précédemment `test.skip`, passe désormais avec HTTP **407 sans Basic, HTTP 200 avec Basic**, corps `from the browser` et `Host` d'origine ; le backend ne reçoit **aucun `Proxy-Authorization`**. Un nouveau test exerce des réponses HTTP découpées entre des limites de chunks TCP, des extensions de chunk et une bande-annonce, sans divulgation du secret proxy. Les tests CONNECT, reprise d'attachement, destination privée/non-web et filtre opérateur G86 demeurent exécutés. Tests natifs ciblés locaux : **69 pass, 0 skip, 0 fail**, typecheck `plugin-browser` vert ; les preuves CI doivent correspondre au SHA publié.

## Limites explicites — NO-GO production

Le parser G93 cible **HTTP/1.0 et HTTP/1.1** sur le chemin HTTP direct ; CONNECT/WebSocket conservent le parcours natif antérieur. Les réponses HTTP/2 brutes, protocol upgrades hors WebSocket, extensions Transfer-Encoding non-chunked, en-têtes trop grands et framing ambigu restent refusés. Une validation de compatibilité complète dans le Desktop Electron officiel est toujours absente. Les cas de réponses anticipées pendant un gros upload, de trailers complexes et de serveurs malformés nécessitent un fuzzing/réseau indépendant avant toute qualification prod.

G93 **n'atteste toujours pas le premier processus Electron** : `RpcCallContext` ne fournit pas d'identité de transport fiable. Le refus G85 des destinations privées/non-web reste la valeur par défaut ; seules les exceptions IP/port explicites par opérateur G86 existent et demeurent accessibles à un éventuel premier client auto-attaché. L'auto-grant navigateur et la propriété atomique du grant ne sont pas corrigés ici. Les outils WebBridge `navigate`, `click`, `fill`, `submit` restent OFF, les cinq fournisseurs web ne sont pas qualifiés production. Aucun merge, modification de l'application officielle ou test Electron n'est inclus.
