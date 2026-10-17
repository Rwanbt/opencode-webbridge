# ADR 0060 — D01/D02 : GUI/Desktop 2.0.32 public, preuve négative et chemin de compatibilité

**Décision : NO-GO pour une extension GUI externe et pour le Browser DOM officiel dans le Desktop 2.0.32 empaqueté.** Le plugin serveur installable WebBridge conserve sa compatibilité native par `provider.transform`/modèle synthétique et RPC. Aucune recompilation ou modification du Desktop officiel n'est nécessaire pour cet usage, mais le chargement du modèle dans le *sélecteur graphique empaqueté* n'est pas encore attesté par un essai Electron réel.

## Sources officielles et observation

Tag `anomalyco/opencode` **2.0.32** → SHA `843a6c514e606b436a7fe713422ace0a93ad3d61`. Le module `scripts/probe-d01d02-desktop-public-api.mjs` vérifie les SHA256 intégraux de **quatre vrais fichiers à ce SHA**, puis transpile et **exécute le véritable handler officiel** `packages/desktop/src/main/ipc-handlers/extensions.ts` dans un VM Node isolé avec son service Effect minimal simulé. En mode `app.isPackaged=true`, les appels réels `ExtensionInstall`, `ExtensionSource`, `ExtensionEnable`, `ExtensionReload` renvoient `unavailable` **avant tout accès au host** ; le cas de contrôle `app.isPackaged=false` atteint `host.install`. Cela prouve la branche de refus du code officiel exécutée, **pas** une exécution Electron/IPC native.

La composition `packages/gui-extensions/src/renderer.ts` est également exécutée depuis le fichier officiel : uniquement **13 built-ins** (`browser` inclus). `packages/app/src/runtime/extension/builtins.ts` importe cette composition fixe. Le `Context` public de `packages/plugin/src/promise/plugin.ts` expose `provider` et `rpc`, **sans** `renderer`, `gui` ni `browser`. Les deux SDK/hosts sont distincts. La disponibilité visible de `ExtensionInstall` dans un type renderer ou du SDK `@opencode/gui-extensions` **n'autorise pas** l'installation dans un build public ; le gestionnaire est conditionné par `app.isPackaged`.

Le test d'intégration Linux isolé CI installe le CLI officiel **`@opencode/cli@2.0.32`** (version effectivement publiée) et reprend le test WebBridge G97 du **même paquet `.tgz`** exposant RPC et modèle synthétique, avec échanges sur serveur local. Il ne lance aucun Electron/Chromium, aucun compte ou service commercial. Le poste Windows actuellement chargé n'est pas sollicité pour un nouveau Desktop.

## Chemin réalisable, indépendant des changements upstream

Distribuer le plugin serveur WebBridge en paquet externe installé par le mécanisme officiel OpenCode, avec `provider.transform`, modèle synthétique, RPC et fixture locale strictement opt-in. Vérifier modèle et réponse via le CLI natif sur la même version 2.0.32. La surface graphique Desktop peut déjà exploiter le modèle présent dans son serveur, mais la **découverte par son sidecar**, le **choix dans le sélecteur GUI** et le **rendu réel** restent à prouver dans une session empaquetée sûre. Aucun panneau GUI/plugin navigateur externe ne doit être annoncé comme fonctionnel à ce stade.

## Contrat public upstream minimal nécessaire pour D02

1. Pour le Desktop empaqueté : un installateur graphique **explicitement supporté** acceptant uniquement une provenance éditeur/artefact vérifiée, avec permissions et révocation, puis un point de chargement documenté des bundles renderer tiers dans `createHost({definitions})`. Il doit activer et retirer des contributions `Panel`/`Command` sans édition de `src/renderer.ts` ni injections dans le DOM.
2. Pour le navigateur : un contrat d'hôte médié par Core qui identifie instance Desktop et onglet/génération, fournit métadonnées d'onglets et lecture `snapshot.once` après contrôle de permission/consentement et `read.commit`/`read.live` au point d'effet. La provenance du plugin/agent/tool doit être issue de l'exécuteur de confiance ; aucun plugin ne peut s'auto-attester.
3. Pour le pont serveur↔GUI : découverte du plugin serveur et des modèles depuis le service auquel la fenêtre est réellement liée, notification de disponibilité/révocation, contrat d'échec explicite. La preuve cible doit être un vrai E2E **sur Desktop officiel empaqueté** : installer un paquet tiers signé, afficher sa contribution dans un panel, sélectionner le modèle synthétique, faire un tour local, retirer le paquet et confirmer le rollback. Aucune dépendance à OCDX.

## Validation et limites

`npm run check:d01d02` est une **preuve exécutable négative de source officielle vérifiée**, avec VM et doubles pour l'environnement Electron/Effect. Un succès signifie « API GUI externe non utilisable sur ce build », jamais « GUI testé ». La CI native `official-v2-032-cli-plugin` est une preuve CLI **séparée**, jamais une preuve de compatibilité GUI. Les limites G111/ADR 0058 (signature AppImage, isolation sidecar et RAM locale) demeurent. **0/5 fournisseurs commerciaux, navigateur en lecture seule, browser writes OFF, NO-GO production/GUI.**
