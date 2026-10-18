# ADR 0049 — G97 : paquet autonome RPC et modèle factice, NO-GO

G88 (#172) a prouvé un appel modèle CLI réel vers une inférence factice SSE
alimentée par le RPC d'un paquet installé, mais le **modèle venait d'un
second dossier plugin réexportant le build du dépôt**. G97 supprime
ce défaut de provenance : **un seul plugin natif installé depuis un .tgz**
enregistre à la fois `ctx.rpc.register` et `ctx.provider.transform`.

Son module `index.mjs` importe uniquement `node:crypto` ; il reproduit les
champs `Model.Info.default` / `Provider.Info.empty` du SDK OpenCode
V2 épinglé, mais ne dépend pas du SDK à l'exécution. La sélection par
`opencode run --server --model webbridge-fixture/webbridge-native-fixture`
utilise **uniquement** le plugin de `node_modules` du préfixe temporaire.
L'inventaire `/api/plugin` doit contenir le plugin combiné actif,
et pas les deux anciennes fixtures natives ; aucun dossier modèle séparé
n'est configuré. Le faux serveur OpenAI-compatible reste un service
HTTP local sur `127.0.0.1`, distinct du paquet, sans site commercial.

Le harness G81/G88 conserve les assertions de création de deux tarballs
identiques (SHA256 et intégrité npm SHA512), installation 0.0.1,
upgrade 0.0.2, archive altérée refusée avant npm, rollback 0.0.1,
désinstallation, faux secret/scope/nonce et rejeu RPC refusés. Les deux
tours modèle CLI doivent recevoir un marqueur dépendant du HMAC RPC
et au moins deux fragments SSE. Plusieurs requêtes d'inférence
fictives peuvent être émises par le moteur CLI, mais elles réutilisent
un seul reçu RPC authentifié sans rejeu natif.

Le plugin refuse toute activation sans les deux opt-ins test,
le secret RPC et le Bearer de 256 bits et l'URL exactement locale
`http://127.0.0.1:<port>/v1` (sans credentials, query, fragment).
Le modèle interdit les outils et accepte uniquement du texte.
Les archives sont des prévisualisations locales reproductibles ;
**aucun contrat de provisionnement web ni mécanisme de distribution
commerciale n'est implémenté**.

**NO-GO :** seule la CLI officielle OpenCode 2.0.29 est testée ici ;
pas de Desktop/Electron installé 2.0.32, ni navigateur, compte,
login, service commercial, permissions Core effets, terminal,
fichiers ou garantie de production. La CI native exécute un modèle
**fictif** et un serveur SSE local ; cela ne vaut pas authentification
commerciale ni streaming d'une vraie page. **0/5 commerciaux,
0 production, aucun merge.**
