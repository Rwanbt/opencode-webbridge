# ADR 0068 — G119 : coexistence du patch Core G106 et du modèle/page G113

**Statut : intégration reproductible, Linux CI uniquement, NO-GO produit.**

G106 [#187] (`aaefcf8c0ef2776ba6bd62a587eafbe749f18b30`) contient
le patch **complet** de contrôle Core/Browser/Desktop du V2 officiel,
sur le commit fixe `4617210822bdbb31e5749751afbfb4584ccedac8`.
Il protège notamment la réponse `browser.tabs.list` lorsque les
règles enregistrées, hooks, autorisations de session ou epoch changent
pendant un contrôle ou pendant l'attente du résultat du host.

G113 [#190] (`e1a04479876fcb469309cbbb9526639964bf35e3`) prouve,
séparément, qu'un paquet npm de test **unique** installé dans une CLI
officielle OpenCode 2.0.29 expose modèle + RPC locaux ; un vrai
Chromium Linux restitue des fragments DOM via un flux SSE fictif et
les fautes changement d'onglet/fermeture réelle de page sont refusées
sans succès terminal usurpé. Son patch V2 historique était plus petit :
154 617 octets, SHA256 `769C1611BE8987ACADA7816728E091DD90D4FF0E90E5542121AA2D96645DE5CE`.

G119 repart **exactement de G113** sans `git merge` ni modification de
l'upstream. Il transporte octet pour octet l'artefact G106 complet,
206 926 octets, SHA256
`FE5AE887CA3FEB1C2A2E170A12B7A9C89E79684E80EE5CE656C7377604F753E8`,
sans tenter de fusionner textuellement les deux patches. Il conserve
inchangés les fichiers exécutables de la fixture native G113.
Le test négatif ciblé est **RED avec le patch G113 original** et GREEN
après substitution de G106 ; une troncature ou modification même minime
de l'un des fichiers échoue avant toute exécution native.

Sur le même SHA WebBridge et dans **le même job Linux CI**, le smoke
G100/G113 exécute d'abord le vrai modèle CLI, le DOM local, le RPC
et les fautes d'onglet/fermeture. Ensuite, un checkout jetable du
SHA officiel V2 effectue `git apply --check` puis `git apply`
du patch G106. L'autre job CI dédié installe ses dépendances Bun et
exécute les tests ciblés des permissions, des révisions du broker,
des leases et des barrières Browser/GUI sur ce **même artefact**.
Les empreintes assurent que les jobs ont testé les mêmes sources.

**Frontières distinctes :** le CLI de G113 exécute un paquet de test
local ; il ne consomme pas les modifications Core V2 de G106 dans
son runtime commercial, et le replay du patch n'installe **aucun**
binaire Desktop. La coexistence des deux preuves dans une CI n'est
ni un branchement Core→Electron, ni une transaction interprocessus,
ni une autorité navigateur de production. L'attestation du premier
processus Desktop, le sélecteur GUI, les sites et comptes réels,
les cinq fournisseurs commerciaux et les écritures navigateur restent
hors preuve. Les lignes de whitespace déjà présentes dans l'artefact
G106 sont conservées délibérément pour garantir le SHA exact : elles
ne sont pas retouchées dans cette intégration.

**0/5 fournisseurs commerciaux, 0 production, écritures WebBridge OFF,
Electron NON testé, OCDX exclu, aucune fusion.**
