# ADR 0028 — G76 : prévisualisation reproductible de paquet hors ligne, NO-GO

**Statut : distribution expérimentale de test, aucun modèle commercial utilisable.**

Le banc natif G1 installe déjà un *répertoire* de plugin directement dans une
configuration éphémère et prouve l'inférence d'un modèle local fictif. G76 vérifie
un chemin distinct : création de deux archives npm `.tgz` identiques à partir de
sources indépendantes, SHA256 identique, installation depuis une archive avec
`npm --offline --ignore-scripts`, mise à jour `0.0.1 → 0.0.2`, refus avant
installation d'une archive modifiée, rollback `0.0.2 → 0.0.1`, puis
désinstallation. Après chaque étape, le manifeste et le code installé sont
lus et vérifiés. L'archive contient **uniquement deux fichiers** :
`package.json` et `index.mjs` statique sans dépendances.

L'entrée `opencode.webbridge.preview` est volontairement **inerte** :
`setup() {}` ; ni modèle, ni fournisseur, ni commande, ni outil, ni navigateur.
Elle sert à vérifier la distribution et la compatibilité du chargeur des
plugins; elle ne constitue pas une release fonctionnelle de WebBridge.
Elle reste distincte de `src/index.ts`, également inactif en production.

Le script crée son propre dossier dans le répertoire temporaire et n'accepte
**aucune destination d'installation extérieure**. npm est invoqué via son
point d'entrée JavaScript, sans shell, avec `--prefix` et cache/config/
HOME/APPDATA/XDG dans ce dossier et sans héritage des credentials.
Aucun `npm install -g`, aucune écriture à la config de l'OpenCode officiel.
Une vérification facultative lance **un seul serveur OpenCode CLI 2.0.29** sous
ce profil isolé, sans Chromium, et exige que `/api/plugin` expose l'identité
du paquet installé. Le serveur impose un mot de passe éphémère généré localement,
et la vérification utilise uniquement cette authentification HTTP locale ;
les diagnostics masquent sa valeur. La CI réutilise la CLI du job G1.

**Limites :** l'essai natif démontre uniquement la découverte d'un plugin
inerte, sans Desktop/Electron ni activation de modèle. Aucune signature de
release, aucune migration de données utilisateur, aucune transaction Core
ni attestation de consentement de fournisseur. Tous les sites commerciaux
restent interdits/éteints : **0/5 fournisseurs, 0 production**.
