# ADR 0032 — Compatibilité locale par exemption explicite de l'opérateur serveur

## Constat reproduit

Le patch G85 bloquait toutes les destinations loopback/privées et les ports non HTTP(S) dans **l'unique** `BrowserTunnel.open` officiel. Le Desktop Electron natif invoque ce même RPC depuis `packages/gui-extensions/src/browser/network.ts:21-34` avec la preuve V6 de l'attachement. Ce n'est pas un appel propre à WebBridge. Le test historique officiel `packages/plugin-browser/test/tunnel.test.ts` échouait **3/3** sous G85 sur Windows. Les tests TCP/fermeture dépendaient de loopback et de ports éphémères. Deux de ces trois échecs étaient néanmoins déjà reproductibles dans la copie G63 antérieure à G85 sous Windows : réception vide sur le relais TCP auto-écho et HTTP 502 dans le proxy Node/Bun.

Le contexte `packages/plugin/src/effect/rpc.ts` n'expose qu'une fabrique `error`, sans identité cryptographique ou transport attesté de l'appelant. Un indicateur `webbridge`, `native` ou `trusted` ajouté à `attachmentProof` / `tunnel.open` serait librement forgeable. **Il est impossible de différencier de manière fiable WebBridge et le Desktop natif à cette frontière sans changer le transport Core.**

## G86 : frontière serveur limitée, fail-closed par défaut

G86 conserve les refus G85 de destinations privées/réservées, de rebinding DNS et de ports non standard. Un administrateur du **processus serveur OpenCode**, et uniquement lui, peut explicitement déclarer des exceptions avec la variable `OPENCODE_BROWSER_TUNNEL_ALLOWED_PRIVATE_TARGETS`, par exemple `127.0.0.1:5173,localhost:3000,[::1]:8080`. Pas de wildcard, CIDR, nom DNS arbitraire, ni autorisation fournie dans le RPC. Un hôte IP est apparié exactement à sa résolution et à son port ; `localhost` n'est autorisé que si toutes ses réponses DNS sont loopback. Le socket continue à utiliser l'IP contrôlée avant connexion. Le DNS et le contrôle de fermeture restent actifs.

Le nouveau test adversarial est **RED G85 → GREEN G86** sur un vrai listener local : un seul port approuvé peut être joint ; son voisin et un faux `trusted: true` transmis par le client ne contournent pas la règle. Sans cette configuration serveur, les anciens tests d'attachement auto-déclaré restent des refus. Les tests historiques de transfert TCP et d'interruption réutilisent une exception limitée au port du fixture et passent. Le test HTTP proxy historique reste désactivé **sur Windows seulement**, car sa 502 existe aussi avant G85 ; il reste actif sous Linux dans la CI. Cette situation n'est pas une certification Electron.

## Compromis et NO-GO obligatoire

La compatibilité locale est **opt-in** : l'installation officielle sans variable ne peut toujours pas consulter automatiquement des serveurs localhost, privés ou sur ports non standards. L'exception est **globale pour le serveur** et accessible aussi à tout client API qui réussit à s'attacher en premier. Elle n'authentifie pas l'opérateur du RPC et n'est donc pas une frontière propre à WebBridge ; l'administrateur accepte explicitement cette exposition pour chaque destination approuvée. Aucun fournisseur commercial n'est activé ; `navigate`, `click`, `fill` et `submit` WebBridge restent **OFF**.

La prochaine sécurité indispensable est une identité transport Core↔Desktop attestable, liée à la session, workspace, utilisateur, génération et connexion, vérifiée **avant** `attach`, grant et tunnel, avec révocation transactionnelle. Tant que cette preuve n'existe pas, la première auto-attache et l'auto-autorisation de session restent possibles : **production NO-GO**. Aucun test Electron officiel, installation utilisateur ni intégration upstream n'est revendiqué.
