# ADR 0031 — Restriction réseau du tunnel RPC en l'absence d'attestation Desktop

## RED native et origine

Le protocole V6 `experimental.browser.attach` ne lie pas le premier client à l'identité du processus Electron. L'interface officielle `RpcCallContext` n'expose que `error` et aucune preuve de provenance du transport. Un client déjà autorisé par l'API peut choisir librement `connectionID` et `attachmentProof`. Le test natif du véritable `BrowserConnection.make`, avec un serveur TCP réel sur `127.0.0.1`, démontre qu'un premier appelant auto-enregistré utilisait `tunnel.open` pour joindre ce service local : **RED avant G85**.

## Mesure de réduction du risque

La surface RPC continue à accepter les connexions V6 de première partie, sans revendiquer d'attestation. En revanche, `BrowserTunnel.open` refuse désormais, avant tout socket, les adresses privées, locales, réservées, mappées IPv4/v6 et les ports autres que **80/443**. Le Core résout le nom par DNS, refuse l'intégralité d'une réponse contenant une adresse interdite, puis compose la connexion à **l'adresse IP contrôlée**, sans seconde résolution susceptible de provoquer un DNS rebinding. Après l'attente DNS, il revalide la fermeture du tunnel et la limite de 64 connexions.

Les tests exécutables couvrent le premier `attach` V6 auto-déclaré face à un vrai listener loopback, les classes IPv4/IPv6 refusées, les plages publiques autorisées en classification et le refus des ports non web. Les tests ne contactent aucun fournisseur externe, ni compte réel. Le correctif est un **filtre des destinations du tunnel serveur**, pas une authentification de Desktop.

## Compromis et NO-GO

Le navigateur de première partie continue d'utiliser le tunnel pour les services web publics en HTTP(S) sur leurs ports standards ; en revanche, **les serveurs de développement localhost, les réseaux privés, les ports non standards et certains services IPv6 spéciaux deviennent inaccessibles depuis ce proxy**. Les anciens tests réseau de `test/tunnel.test.ts` utilisent précisément un listener loopback et ne vérifient plus une opération autorisée ; ils nécessitent un harness de transport isolé dédié avant toute certification de la suite complète. Les tests ciblés G85 et les parcours CI de la proposition sont distincts de cet ancien harness.

L'identité du **premier** `attach` demeure non attestée : un client API autorisé peut encore se déclarer propriétaire de session, influencer la permission `browser:*`, annoncer des états et accéder aux destinations publiques autorisées. La permission de session actuelle n'est pas une transaction atomique avec vérification d'identité. Une véritable correction exige une provenance vérifiée dans la couche transport Core↔Desktop avant tout `attach`/grant/tunnel, puis une délégation liée à session, workspace, processus, génération et renouvellement. Aucun E2E Electron officiel, aucun modèle fournisseur commercial en production, aucune autorité d'écriture WebBridge et aucune fusion ne sont autorisés par cet incrément.
