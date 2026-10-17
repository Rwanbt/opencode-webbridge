# E2 indépendant — preuve opérateur et chemins physiques (#93)

**Deux contre-exemples RED** ont été démontrés contre #93 `dbe1ac5`, sans modification du worktree de son auteur :

1. `--evidence-file` était lexicalement externe, mais une **jonction parente** pointait vers le journal. Une preuve physiquement interne a été acceptée, et `resolve` a changé `prepared` en `reconciled`.
2. Un nom de fichier externe était un **lien matériel** du même inode qu'un fichier de preuve interne. Même résultat : réconciliation autorisée.

Le correctif compare les `realpathSync` physiques du journal et de la preuve après ouverture du descripteur, rejette les chemins effectivement internes, et refuse les fichiers à plusieurs liens (`nlink !== 1`). Les deux contre-exemples passent en GREEN et les tests positifs préexistants conservent la réconciliation d'un fichier externe régulier.

**Limites** : un SHA-256 de fichier vérifié n'établit ni l'origine d'un événement web, ni la sincérité du constat de l'opérateur. Un stockage physiquement modifiable reste vulnérable aux pivots concurrents de chemin et aux manipulations sous-jacentes du filesystem ; ce contrôle réduit deux contournements concrets sans créer une frontière de confiance infaillible. Le journal et le témoin restent soumis à une transaction **non atomique entre fichiers**, et la réconciliation exige toujours une vérification humaine indépendante. Aucune navigation, donnée d'un compte web ou certification de production.
