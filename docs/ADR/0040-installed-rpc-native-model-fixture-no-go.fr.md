# ADR 0040 — G88 : paquet RPC installé → modèle CLI natif → SSE de test

**Statut : preuve hors ligne, non distribuable aux utilisateurs.**

G66 prouve un parcours modèle OpenCode V2 → relais RPC vers une
implémentation de test réexportée depuis les fichiers compilés du dépôt.
G81 prouve un paquet npm `.tgz` RPC autonome, mais seulement au moyen
de la méthode `/api/rpc/.../challenge`. G88 relie les deux preuves :
le **RPC appelé par le modèle** provient du paquet réellement installé.

Le paquet RPC test autonome G81 est compilé sans dépendance externe,
emballé deux fois à SHA identique, installé hors ligne dans un profil
éphémère, mis à jour 0.0.1→0.0.2, rollback 0.0.2→0.0.1 et désinstallé.
Sur chacune des deux versions, un serveur CLI **OpenCode officiel v2.0.29**
charge le paquet (identité `active`) et le plugin modèle de test G66,
celui-ci restant un **répertoire de fixture local**, non un produit.
Une commande `opencode run --server ... --model webbridge-fixture/webbridge-native-fixture`
envoie un prompt synthétique à un faux serveur OpenAI sur `127.0.0.1`.
Ce serveur exige ensuite une réponse HMAC réelle de
`/api/rpc/webbridge-g81-package/challenge`, sous secret éphémère,
avant d'envoyer **deux fragments SSE successifs**. Le résultat du tour
CLI doit contenir la preuve dérivée du HMAC ; le simple chargement
du plugin ou un faux modèle déconnecté ne suffisent pas.

Contrôles négatifs : sans liaison RPC, le faux modèle répond HTTP 503 ;
sans son Bearer, HTTP 401. G81 vérifie déjà refus de faux scope, faux
secret, nonce rejoué et archive altérée. Secrets exclus des variables
héritées, aucune authentification commerciale ni URL hors loopback.
Deux serveurs CLI sont lancés **séquentiellement**, sans Electron ni
Chromium supplémentaires. Aucun binaire officiel n'est recompilé ou
remplacé, aucune configuration utilisateur n'est modifiée.

**NO-GO :** cette preuve est une exécution d'un **modèle fictif** dans
le CLI natif, pas une exécution de fournisseur commercial, ni une
intégration Desktop/Electron. Le modèle est chargé depuis le build
de fixture du dépôt et non depuis le paquet RPC ; le paquet testé
est non commercial. Les fragments SSE concernent le transport de
la fausse inférence : ils ne prouvent pas une page distante, des outils,
une autorité Browser/Computer Use, ni la production. **0/5 commerciaux,
0 production.** Une intégration réelle nécessiterait preuve Core↔Desktop
et consentement d'usage par fournisseur.
