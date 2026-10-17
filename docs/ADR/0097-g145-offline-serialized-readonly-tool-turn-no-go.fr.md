# ADR 0097 — Tour de lecture d'outil sérialisé, consenti et durable (G145)

**Statut : fixture Linux uniquement ; NO-GO production.**
Branche et worktree isolés basés sur G141 #219, aucune modification du
point d'entrée distribué, des fournisseurs E5 ou des patches native Core.

## Objectif et connexion réellement implémentée

Les modules validés indépendamment G133 (schéma strict), G138 (UTF-8/JSON
borné), G135 (lectures de fichiers/Git isolées), G136 (consommation unique)
et G140 (journal anti-rejeu HMAC) ne possédaient pas de **tour complet**
utilisant leurs vrais contrats dans le même exécuteur.

`OfflineToolTurnOrchestrator.run` relie désormais concrètement :

1. Entrée brute **strictement sérialisée** → `ingestToolProposalJSON` ;
   les objets JavaScript, commandes mutables, clés dupliquées, identité
   forgée et valeurs malformées sont refusés **avant** tout consentement.
2. Proposition normalisée, immuable et liée au scope host → hash SHA-256
   → réservation `ToolBroker` par opération ; doublons refusés.
3. Journal HMAC/témoin créé au chemin stable du hash dans **deux répertoires
   de test canoniques disjoints**. Une histoire existante ou corrompue
   bloque toute tentative de replay après un redémarrage.
4. Autorisation host-owned, consentement explicite, nouvelle autorisation
   après l'attente ; `fence.consume` **persisté avant** `broker.consume`
   et avant tout accès fichier/Git.
5. Le vrai exécuteur G135 limite les opérations aux
   `file.read/git.status/git.log/git.diff` dans un workspace jetable,
   interdit les effets terminal arbitraires et vérifie les permissions
   avant/après lecture. Le contenu sensible détecté reste non divulgué.
6. Vérification de reçu par **callback de fixture du host** puis
   `confirmed` durable avant livraison du texte, sinon
   `uncertain` irréversible et aucun résultat retourné.

Les tests couvrent de vrais fichiers Git et Linux, double requête
concurrente, redémarrage après confirmation, échec du reçu, révocation
pendant `await`, interruption avant effet, identité forgée et rejet
Windows pour la lecture fichier dont les handles ne sont pas prouvés sûrs.

## Frontières et refus d'activation

Les callbacks `authorize`, `approve` et `verifyReceipt` sont
**simulés par le propriétaire du test**. Une page web ou un modèle ne
peut pas les fournir ; ils ne constituent pas une autorité native Core.
Le journal crée ses fichiers dans l'OS tmp et n'est pas un stockage
anti-rollback séparé et protégé par l'OS. Une course vers un parent
symlink, crash matériel, ou auteur pouvant supprimer les deux témoins
exige un vrai host/SecretBroker. Un crash en phase `consuming` reste
délibérément bloquant jusqu'à réconciliation hors ligne.

Ce composant est dans `src/testing/`, **pas importé par le plugin
distribué**. Aucune commande terminal, écriture Git, requête réseau,
automatisation commerciale, navigateur Desktop ou sous-agent n'est activé.
La persistance de permission OS, la chaîne même-processus Core↔Chromium,
la GUI Electron packagée et la contractualisation restent NO-GO.
`commercialProvidersOperational=[]`, `productionAcceptedStoryIDs=[]`,
`webbridgeWritesEnabled=false`.
