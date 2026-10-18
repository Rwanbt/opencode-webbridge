# ADR 0096 — G144 : Core natif, contrats E5 et véritable paquet racine dans une CI commune

**Décision : intégration de qualification uniquement ; production NO-GO.** La branche G144 part exclusivement du commit vérifié G141 `0fd5e2fa04df4238e12277ac8674d0d6da8d71d3` (PR #219), dont les workflows push et PR étaient tous deux verts (7/7). Aucun merge, changement du Desktop officiel ou activation des fournisseurs web.

## Sources reprises sans réécriture

- PR #220 G134, commit `bbca97f9aec367dca4fd33779a54d1ff14875754`, workflows push `39072527835` et PR `39072786656` verts (7/7) : les six fichiers exacts du commit sont rejoués, dont `adapter-contract.ts`, `offline-adapter-session.ts`, deux suites adversariales et l'ADR 0085.
- PR #221 G143, commit `539fe2c86b7ab679c8fa59f6d60d0d435d0e43a1`, workflows push `39072912781` et PR `39072933164` verts (8/8) : les six fichiers et leurs ajouts exacts sont rejoués ; `.github/workflows/ci.yml` conserve le contenu préalable de G141 et ajoute seulement le job G143 et le smoke de paquet sous Windows.
- Le patch natif Core V2 reste appliqué exclusivement à la source officielle épinglée `4617210822bdbb31e5749751afbfb4584ccedac8`, avec SHA-256 de patch `77B5FF872F5F3D1EB641896AD16FC6C50D8F21AD54BFA797D7519F1990A0685F`. La CI native assure sa validation séparément du CLI public.

## Invariants de la qualification croisée

Le même SHA G144 doit réussir dans les deux workflows GitHub : tests E5 de refus des objets adversariaux et isolation de session, politique et provenance G141/G142, replay du patch Core V2, parcours CLI officiel `2.0.32` de fixture avec Chromium local, RPC, SSE, ACK hôte chiffré et reprise, puis **paquet WebBridge racine réellement compilé et installé** dans un profil CLI jetable. Le véritable point d'entrée `src/index.ts` reste volontairement **inerte**. Les fixtures G125/G130 n'appartiennent pas au paquet WebBridge racine réellement distribué.

La vérification d'archive SHA-256/SHA-512 et le SDK public épinglé à `@opencode/plugin@2.0.29` sont des preuves d'intégrité et de chargement limitées, sans signature de provenance externe. Le Core V2 patché, le CLI public et le Desktop Electron ne sont pas attestés dans un même processus. Aucune attestation OS/Windows Electron, aucune autorisation d'écriture navigateur, aucun compte commercial réel et aucun fournisseur commercial activé.

Les valeurs de gouvernance restent `commercialProvidersOperational=[]` (0/5), `productionAcceptedStoryIDs=[]` (0/54), `webbridgeWritesEnabled=false` et `commercialAutomationAuthorized=false`. Décision finale `NO-GO-PRODUCTION` inchangée, indépendamment des tests verts.
