# ADR 0013 — Rétablir les métadonnées d'onglets depuis l'état Core déjà autorisé

## Problème et frontière

G58 refusait volontairement toutes les anciennes lectures GUI/agent hors `snapshotOnce`, y compris `tabs.list`. Cette mesure empêchait à tort les outils de première partie `browser.tabs.list` et `ctx.browser.tabs` de retrouver les onglets actifs. L'état des onglets est pourtant déjà transféré par `rpc.state` depuis l'attachement Desktop V6 : cette opération valide la preuve privée de connexion et demeure isolée par `sessionID` dans `BrowserConnection`. Les URL et titres ne sont **pas publics** : ce sont des métadonnées potentiellement sensibles.

## Décision

Le broker de connexion fournit une **copie détachée** de `Browser.State` pour la session encore attachée et initialisée. Le host intégré `ctx.browser.tabs` renvoie ces métadonnées après les contrôles Core `browser` et `browser_plugin` existants. L'outil de première partie `browser.tabs.list`, dont la déclaration est munie de `permission: "browser"`, lit le même miroir **côté Core** sans exécuter d'action du navigateur. `target.request({type:"tabs.list"})`, `target.inspect`, `browser.pane.command` et le chemin GUI RPC direct restent refusés. Aucun snapshot ou capture n'est implicitement accordé par une simple liste d'onglets.

Un test hôte avec attachement V6 vérifie les métadonnées, l'absence d'émission d'une commande Chrome/IPC, le refus du vieux RPC, l'absence de lecture d'une autre session, l'ignorance d'un `state` usurpé par mauvaise preuve privée et la propriété de copie indépendante lors du changement de génération. Le test ne certifie pas la sécurité de la provenance d'`attach` ou la fiabilité des URL fournies par un Desktop lui-même compromis.

## Limites / NO-GO

La permission `browser` historique est ajoutée automatiquement à la session lors d'`attach`; **elle n'est pas une attestation d'identité du processus Electron**. Un client API autorisé peut encore tenter un nouvel attachement : authentification du caller et sérialisation attach/session-grant restent bloquantes. Aucun test Electron GUI réel ni atomicité Core ↔ Chromium n'est démontré. Les lectures sensibles (`frames`, `evaluate`, `screenshot`, `network.*`, `files.get`, `snapshot`) demeurent inaccessibles par les anciens outils; `snapshotOnce` reste la seule voie de lecture autorisable. Les writes WebBridge et l'automatisation des cinq services commerciaux restent désactivés. Aucune acceptation production ni merge.
