# G21 — Attestation opérateur liée à un fichier de preuve contrôlé

Le CLI `scripts/reconcile-relay.mjs` pouvait accepter n'importe quelle empreinte SHA-256 plausible à la place d'une preuve vérifiée. Un opérateur pouvait donc passer `resolve` avec un hash inventé, puis marquer un tour incertain comme réconcilié. Le test négatif démontre le comportement original (RED).

Pour `resolve`, les paramètres **`--evidence-file`** (chemin absolu) et `--evidence-sha256` (empreinte attendue) sont désormais obligatoires. Le fichier doit être externe au répertoire du journal, régulier, non vide, d'au plus 64 Kio ; son contenu exact est lu depuis un descripteur après validation et hashé localement avant toute transition. Le contenu de la preuve n'est **jamais** imprimé ni recopié dans le journal : seule l'empreinte SHA-256 est enregistrée sous HMAC, avec l'identifiant d'opérateur haché. Les fichiers modifiés, absents, hors taille ou à empreinte discordante sont refusés sans mutation d'état.

`--witness-dir` (chemin absolu optionnel) permet au même CLI d'ouvrir et de réconcilier un journal G19 version 2 ; en omettant cette option, le journal protégé refuse le mode non témoigné. Les tests couvrent la lecture et la réconciliation du journal avec témoin, les refus de hash seul, de contenu modifié et de mode dégradé.

**Limites :** la correspondance cryptographique d'un fichier avec une empreinte **ne prouve pas** que le contenu est une observation authentique du navigateur distant ni qu'il exclut des effets déjà réalisés. Une revue humaine autorisée doit encore vérifier l'origine et la signification de la preuve. Une signature de source d'observation ou une preuve issue du pilote de confiance reste à concevoir. Aucun outil ou site commercial n'est exécuté par la commande.
