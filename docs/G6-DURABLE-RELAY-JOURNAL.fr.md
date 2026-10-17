# G6 — Journal durable et refus des relectures d'actions

**17 octobre 2026 — lot de sécurité validé en environnement de test isolé.**

## Problème observé

Un modèle OpenCode peut émettre plusieurs requêtes d'inférence pour une même session. Une demande remise à un navigateur peut produire un effet externe avant qu'une réponse soit reçue. Une panne entre ces deux événements ne doit **jamais** déclencher une deuxième saisie ou un deuxième clic de manière implicite.

## Garantie apportée

`DurableRelayJournal` conserve, sur disque, seulement une empreinte du propriétaire (session, fournisseur, onglet et référence de compte), les identifiants de tours et leurs états `prepared`, `leased`, `settled` et `cancelled`. **Aucun prompt, résultat, cookie, mot de passe ni jeton n'est enregistré.** L'intégrité du journal est vérifiée par une signature HMAC-SHA256 utilisant une clé externe de 256 bits ; cette clé n'est pas stockée dans le journal.

Chaque transition est écrite via un fichier temporaire, `fsync` et renommage atomique avant d'être reconnue en mémoire. Le système refuse les données corrompues, les états inconnus, une identité différente ou une clé erronée. Un verrou exclusif empêche deux propriétaires simultanés et ne se libère pas automatiquement après un crash. Le durcissement G15 vérifie l'identité du fichier `.lock` et son marqueur aléatoire avant chaque transition ; un processus ne supprime pas à la fermeture un verrou qui ne lui appartient plus.

**Point essentiel :** au redémarrage, un tour `prepared` ou `leased` est *incertain*. Il n'est **pas** redélivré au navigateur, et une nouvelle demande est bloquée. Même un tour `settled` ne peut être renvoyé sous le même identifiant. Les informations du journal ne suffisent pas à recréer une réponse perdue : la réconciliation reste manuelle pour l'instant.

## Preuves et reproduction

```sh
npm test
npm run smoke:rpc
npm run smoke:e2e
npm run smoke:page
```

Les tests couvrent la récupération après fermeture, les tours déjà attribués, les doublons, les états incomplets, les données altérées, la clé invalide et les propriétaires concurrents. Les smokes G3/G4/G5 injectent un répertoire de journal propre dans le plugin RPC **de test seulement**. Celui-ci réside volontairement **en dehors** du répertoire de travail observé par les watchers d'OpenCode ; le placer sous le répertoire suivi a perturbé le chargement du plugin sur Windows.

## Réconciliation et limites

En cas de crash, **ne pas supprimer aveuglément** `.lock`, `journal.json` ou les entrées. Vérifier d'abord qu'aucun propriétaire ne tourne, puis inventorier les tours `prepared`/`leased` et leur résultat dans le navigateur **par un mécanisme explicitement autorisé**. Un opérateur pourra ensuite décider de marquer le tour comme résolu ou abandonné dans un futur workflow d'administration contrôlé ; **ce workflow n'existe pas encore**. La conservation du fichier signé et de sa clé est nécessaire à toute récupération.

Il s'agit d'une protection *fail-closed*, **pas d'une garantie générale exactement une fois** entre le modèle et un site distant. Le verrou ne sécurise pas un répertoire accessible en écriture à un adversaire local, ni toutes les courses entre contrôle et renommage. Le HMAC assure l'intégrité, **pas la fraîcheur** : restaurer une ancienne copie déjà signée du journal reste une attaque de rollback sans ancre monotone externe. Il reste à construire cette ancre, l'autorité d'annulation, la rotation des clés, les sauvegardes fiables, le pairage avec le véritable navigateur Desktop et les audits de permissions. Sur Windows, le `fsync` du répertoire de destination n'est pas disponible comme sur POSIX ; une coupure électrique au mauvais instant demande une analyse spécifique. Les cinq adaptateurs commerciaux restent désactivés.
