# ADR 0095 — Distribution vérifiable du véritable plugin OpenCode (G143)

**Statut : validation limitée au plugin racine inerte, production NO-GO.**
Base G142 #218, nouveau worktree isolé, sans modifications de l'application
officielle, sans compte utilisateur et sans fusion.

## Écart traité

Les résultats positifs G125/G130 CLI 2.0.32 installaient des **plugins de
fixture synthétiques** : cela ne prouvait pas que l'entrée distribuable
`src/index.ts` de WebBridge se chargeait dans une installation CLI officielle.

Le script `smoke-distributed-entrypoint.mjs` construit deux archives npm
de la sortie **réelle** `dist/src/index.js` et compare leurs SHA-256, les
SHA-512 déclarés par npm et la liste exacte des fichiers (code, licence,
manifeste). Le SDK public `@opencode/plugin` est **épinglé à 2.0.29**
dans le manifeste de test et sa version installée est recontrôlée.

Dans un préfixe npm et profil OpenCode **jetables**, le job Linux installe
les versions 0.0.1 puis 0.0.2, refuse une archive corrompue *avant* npm,
revient à 0.0.1 et vérifie la parité binaire du point d'entrée. Il charge
ce package — et non G97 — dans un processus **officiel**
`@opencode/cli@2.0.32`, vérifie l'état actif du plugin dans
`/api/plugin` et l'absence de modèle WebBridge synthétique dans
`/api/provider`. Il désinstalle finalement le package et vérifie la
disparition du préfixe isolé.

Le job Windows vérifie l'archive réelle reproductible et les tests
statiques, **sans** lancer de nouveau Desktop/Chromium. L'accès au registre
npm du job Linux sert uniquement aux dépendances du paquet de test ;
aucun fournisseur web commercial n'est contacté.

## Limites et refus de claims

- **L'entrée distribuée reste volontairement inerte** : aucun vrai modèle
  ChatGPT/DeepSeek/Gemini/Qwen/Mistral, outil, RPC ou navigateur ne devient
  fonctionnel grâce à ce lot.
- Le package a un numéro et manifeste **temporaires de test**, ce n'est
  ni une release npm signée ni une recommandation d'installation publique.
  L'intégrité SHA ne constitue pas une signature de provenance.
- Le CLI officiel et le Core natif patché pour les expériences sont
  **des processus séparés**. Aucune attestation OS/Electron ni atomicité
  interprocessus n'est certifiée.
- Aucun chemin de profil réel n'est lu ou modifié ; tous les artefacts
  sont construits sous le répertoire temporaire propre au test.

Gates inchangées : `commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`, `webbridgeWritesEnabled=false`,
`nativeDesktopElectronE2E=false`. Aucun merge, pas de modification
d'OpenCode officiel, main ou Unifia.
