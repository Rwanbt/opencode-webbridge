# Installation, mise à jour et restauration (strictement externe à OpenCode)

WebBridge s'installe comme **plugin externe** : on n'installe jamais à l'intérieur d'OpenCode, on
ne le recompile pas, on ne le remplace pas. Ce guide ne décrit que des opérations **vérifiées** en
local ou en CI ; tout ce qui n'est pas vérifié est marqué comme tel.

## 1. Compatibilité réellement vérifiée

| Plateforme | État | Preuve |
| --- | --- | --- |
| **Linux** | **vérifié** | CI : native fixture complète (`Native fixture smoke`) + verticales Chromium (`G125`, `G130`, `G149`, `G152`, `G153`, `G155`, `G168`, `G173`, `G178`) |
| **Windows** | **vérifié (sans Chromium)** | CI `windows-latest` : cycle de vie du tarball brut (install → upgrade → rollback → uninstall) + progress RPC borné + CLI 2.0.32 |
| **macOS** | **NON VÉRIFIÉ** | aucun job ni test macOS dans ce dépôt : ne pas présenter macOS comme supporté |
| **Desktop/Electron packagé** | **NON PROUVÉ** | `docs/DESKTOP-LEVELS.fr.md` (IPC d'extension refusé en mode packagé) |

Versions épinglées : **OpenCode CLI 2.0.32** (verticals CI), dépendance `@opencode/plugin` **2.0.29**,
`playwright` **1.64.1**, Node **>= 22.19.0**.

## 2. Installation depuis l'archive npm brute

Aucune copie manuelle de `dist` n'est jamais requise ni acceptée : l'archive est produite par
`prepack` (build + graphe runtime borné). Vérifié par le job `G143` et le test de cycle de vie.

```sh
git clone https://github.com/Rwanbt/opencode-webbridge && cd opencode-webbridge
npm ci
npm pack                    # produit opencode-webbridge-0.0.0.tgz
sha256sum opencode-webbridge-0.0.0.tgz   # empreinte à comparer avant installation
npm install -g ./opencode-webbridge-0.0.0.tgz
```

Puis déclarer le plugin dans la configuration OpenCode de l'utilisateur (liste `plugins`), par
exemple :

```jsonc
{ "plugins": ["opencode-webbridge"] }
```

Le serveur OpenCode officiel doit alors rapporter `opencode.webbridge` comme plugin **active**
(constaté en CI sur Windows et Linux). Sans activation individuelle, tous les modèles restent
**dormants**.

## 3. Configuration minimale

| Variable | Effet | Requis pour |
| --- | --- | --- |
| `WEBBRIDGE_NATIVE_WEB_MODELS` | active individuellement un ou plusieurs fournisseurs (`chatgpt,deepseek,…`) | modèles natifs |
| `WEBBRIDGE_NATIVE_TAB_<PROVIDER>` | **c'est l'autorisation** : `http://127.0.0.1:<port>#<tabID>` (onglet CDP explicitement sélectionné) | envoi/lecture navigateur |
| `WEBBRIDGE_NATIVE_JOURNAL_DIR` | répertoire privé du journal durable de tentatives (obligatoire dès qu'un onglet est déclaré) | anti-rejeu, reprise |
| `WEBBRIDGE_PERSONAL_READONLY_TOOLS` | active les outils read-only `file.read`, `git.status/diff/log` | outils workspace |
| `WEBBRIDGE_PERSONAL_WORKSPACE` | répertoire de travail confiné (chemin canonique absolu) | outils workspace |
| `WEBBRIDGE_PERSONAL_CDP_READONLY` | active l'outil navigateur read-only (avec `WEBBRIDGE_PERSONAL_BROWSER_OWNED=1` et `WEBBRIDGE_PERSONAL_CDP_ENDPOINT`) | lecture d'onglets |

Exemple minimal (ChatGPT + outils) :

```sh
export WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt
export WEBBRIDGE_NATIVE_TAB_CHATGPT=http://127.0.0.1:9222#<tabID>
export WEBBRIDGE_NATIVE_JOURNAL_DIR=~/.webbridge/journal   # mkdir -m 700
export WEBBRIDGE_PERSONAL_READONLY_TOOLS=1
export WEBBRIDGE_PERSONAL_WORKSPACE="$(pwd)"
```

## 4. Consentement navigateur

Chaque autorisation est **par fournisseur, par onglet** : déclarer l'onglet *est* l'autorisation,
la retirer (ou fermer/remplacer/naviguer l'onglet) est la **révocation**. Voir le README
(session consentie) et `docs/OBSERVE-PROVIDER.fr.md` pour l'observation read-only, plus
`docs/REFUSALS.fr.md` pour la signification exacte de chaque refus.

## 5. Diagnostics non sensibles

```sh
node scripts/diagnose-install.mjs <répertoire-installé-du-plugin> 0.0.0 \
  --archive ./opencode-webbridge-0.0.0.tgz --sha256 <empreinte-attendue>
```

Le diagnostic ne lit aucun secret, ne contacte aucun fournisseur et n'imprime ni jeton ni contenu
de conversation. Les gardes locales complètent l'inspection :
`npm run check:policy`, `check:compat`, `check:acceptance`, `check:release`, `check:progress`,
`check:sbom`, `check:g119`.

## 6. Intégrité

- empreinte **SHA-256** de l'archive (à comparer avant `npm install`) ;
- `npm run check:sbom` : 275 paquets épinglés avec intégrité, conformes à `package-lock.json` ;
- empaquetage **reproductible** (`G143` : `reproducible: true`, aucune fuite source/tests/fixtures) ;
- le paquet ne contient que `index.mjs`, `bin/`, `dist/src/` et les fichiers légaux.

## 7. Mise à jour, rollback, désinstallation, restauration

| Opération | Commande | Vérifié par |
| --- | --- | --- |
| Mise à jour | `npm install -g ./opencode-webbridge-<nouvelle>.tgz` | cycle de vie G164 (upgrade) |
| Rollback | réinstaller l'archive précédente avec la même commande | cycle de vie G164 (rollback) |
| Désinstallation | `npm uninstall -g opencode-webbridge` puis retirer l'entrée `plugins` | cycle de vie G164 (uninstall) |
| Ressources temporaires | profils/tarballs de test supprimés par les scripts ; côté utilisateur : supprimer le répertoire du journal si plus aucune tentative n'est en attente | cycle de vie G164 |
| Restauration | réinstaller l'archive, redéclarer l'onglet ; les sessions OpenCode **persistent** pendant l'opération | cycle de vie G164 (session intacte après désinstallation) |

## 8. À ne jamais faire

- **copier `dist/` à la main** dans une installation : l'archive npm est la seule voie supportée ;
- toucher à l'installation **Desktop/Electron** de l'utilisateur (voir `docs/DESKTOP-LEVELS.fr.md`) ;
- supprimer un enregistrement du journal natif pendant qu'une tentative est **incertaine** (utiliser
  `webbridge-journal --abandon`, voir `docs/JOURNAL-OPERATOR.fr.md`) ;
- annoncer une version « publiée » : le projet n'a **aucune release** et reste
  `NO-GO-PRODUCTION` (voir `npm run check:release`).
