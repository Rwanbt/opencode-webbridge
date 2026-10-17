# ADR 0031 — G81 : paquet RPC test actif et réversible, NO-GO commercial

**Décision : prévisualisation de distribution native RPC autorisée en environnement de test exclusivement.**

G76 prouve l'installation et le rollback d'un plugin inerte emballé en `.tgz`.
G81 ajoute un **module test autonome** `fixtures/g81-rpc-preview.mjs`, avec
uniquement l'import Node intégré `node:crypto` : aucune dépendance de dépôt,
aucun lien vers `dist/`, aucun script npm post-installation.
Il enregistre réellement une méthode `/api/rpc/webbridge-g81-package/challenge`
via `ctx.rpc.register` sous OpenCode v2.0.29, après opt-in explicite
`WEBBRIDGE_G81_TEST_ONLY=1` et secret éphémère de 256 bits.

Le paquet versionné est créé deux fois de manière reproductible et vérifié
SHA256 + intégrité npm SHA512. Installation hors ligne sous préfixe isolé,
upgrade 0.0.1 → 0.0.2, refus d'archive altérée **avant** toute installation,
rollback 0.0.2 → 0.0.1 puis désinstallation sont vérifiés.
Les tests natifs activent successivement **deux serveurs CLI indépendants**,
jamais simultanés, depuis le même dossier temporaire. Après upgrade et
rollback, `/api/plugin` doit montrer l'état `active` et le RPC doit fournir
un HMAC valide d'un nonce test. Mauvais contexte, secret erroné et replay
échouent sans produire de second reçu. HTTP Basic utilise un mot de passe
échantillonné par exécution ; aucune valeur secrète ne figure dans les logs.

Les variables d'environnement du CLI sont construites par liste blanche ;
HOME, APPDATA, cache npm/XDG, profil et `opencode.json` sont jetables.
Les appels HTTP sont limités à `127.0.0.1`. Le test n'utilise ni navigateur,
ni Chrome, ni modèle, ni terminal, ni compte commercial. La CI réutilise
l'installation locale existante de `@opencode/cli@2.0.29`.

**NO-GO :** ce RPC n'est qu'un exercice cryptographique borné d'activation.
Il ne prouve aucun effet Core↔Desktop, ni autorité de navigateur, ni
permissions d'outils, ni inférence web, ni signature d'artefact publiable,
ni migration des données d'utilisateur. La fixture n'est pas le plugin
de production et ne s'active pas sans opt-in test. **0/5 fournisseurs
commerciaux opérationnels, 0 production.** Aucune installation dans
OpenCode Desktop officiel n'est effectuée.
