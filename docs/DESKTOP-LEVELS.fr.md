# Desktop / Electron — qualification par niveaux (D01/D03)

Ce document distingue **quatre niveaux de preuve non interchangeables** et dit exactement ce qui
est prouvé, où, et ce qui **n'est pas** prouvé. Aucun résultat de CLI n'est présenté comme un
résultat Desktop.

## Niveaux et état réel

| Niveau | Sens | État | Preuve |
| --- | --- | --- | --- |
| **L1** | test unitaire / fixture, sans application réelle | **prouvé** | `npm test` (suite complète) |
| **L2** | plugin externe installé depuis le **tarball npm brut** dans la **CLI officielle 2.0.32** | **prouvé** | jobs CI `D01`, `G125`, `G130`, `G143`, `G152`, `G153`, `G168`, `G173` + `Windows raw npm tarball …` |
| **L3** | cœur OpenCode expérimental **patché**, testé séparément | **non tenté** (volontairement) | — |
| **L4** | application **Desktop/Electron officielle packagée** exécutant le plugin | **NON PROUVÉ, et structurellement refusé** | `npm run check:d01d02` (voir ci-dessous) |

Le job CI Desktop s'intitule explicitement « **no Electron** » et installe « exact official CLI
2.0.32, **never replace system Desktop** » : l'application Desktop de l'utilisateur n'est jamais
touchée.

## Preuve statique officielle (D01/D02), exécutable

`scripts/probe-d01d02-desktop-public-api.mjs` télécharge (ou lit localement) **quatre sources
officielles épinglées** à un commit précis et vérifie leur **SHA-256** avant de les exécuter dans
une VM sans Electron :

- `packages/desktop/src/main/ipc-handlers/extensions.ts`
- `packages/gui-extensions/src/renderer.ts`
- `packages/app/src/runtime/extension/builtins.ts`
- `packages/plugin/src/promise/plugin.ts`

Ce que la preuve établit, exécutablement :

1. Dans une application **packagée**, les quatre IPC d'extension (`ExtensionInstall`,
   `ExtensionSource`, `ExtensionEnable`, `ExtensionReload`) **rejettent avec « unavailable »
   avant tout effet hôte** (aucun appel `host`/`install`).
2. **Contrefactuel** : en retirant la garde `app.isPackaged`, l'effet s'exécute réellement — le
   banc détecte donc bien la présence de la garde, il ne teste pas une coquille vide.
3. La branche **développeur** (non packagée) atteint bien l'hôte : la limitation est propre au
   mode packagé, pas à notre outillage.
4. Le `Context` du **plugin serveur** officiel expose `provider` et `rpc` mais **aucun domaine
   `renderer`/`gui`/`browser`**.

Verdict machine émis : `NO_GO_PACKAGED_GUI_EXTENSION`, avec `nativeDesktopExecuted: false`.
L'indicateur de planning reste `nativeDesktopElectronE2E=false`.

## Conséquence honnête

Un plugin **serveur** (notre cas : point d'entrée `index.mjs` chargé par le CLI) n'a **aucun
point d'extension** pour injecter une interface dans l'application Desktop packagée, et
l'installation d'extension y est **refusée par conception**. Il n'existe donc pas de chemin
public pour « brancher WebBridge dans l'application Desktop » aujourd'hui. Toute affirmation
contraire serait une invention.

## Chemin de résolution (ce qui lèverait le NO-GO)

1. Une **API publique d'installation d'extension Desktop** (aujourd'hui refusée en mode
   packagé) — la preuve D01/D02 ci-dessus est le test RED qui constaterait son apparition.
2. Un **banc Desktop isolé** : profil Desktop jetable, plugin installé depuis le tarball,
   observation de l'état (sélecteur, session, permissions, outils, rendu, persistance,
   redémarrage, retrait). Cela exige un **environnement utilisateur** et donc un consentement
   explicite ; rien n'est exécuté sans lui.
3. Une **proposition upstream minimale** (branche indépendante) si un point d'extension
   serveur→GUI est introduit ; elle ne modifiera jamais l'installation Desktop de l'utilisateur.

## Ce qu'il ne faut pas confondre

Les preuves L2 (CLI officielle) couvrent : chargement du plugin externe, découverte du
provider, modèles dans le sélecteur, permissions natives, outils, RPC/SSE, persistance et
reprise après redémarrage **dans la CLI**. Elles ne disent **rien** du rendu ni du cycle de vie
Desktop. Les niveaux restent séparés.
