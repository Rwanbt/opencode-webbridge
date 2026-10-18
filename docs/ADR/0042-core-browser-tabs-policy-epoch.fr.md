# ADR 0042 — Révocation de la politique pendant l'inventaire natif des onglets

## Problème et reproduction exécutable

La base G104 #183 repose sur le commit `7826fb37d872754d1d244c6edc4a885b15b64db6`. Le chemin de lecture du contenu `snapshotOnce` utilisait déjà `Permission.Service.browserRead` et `BrowserLease` : les révisions agent, règles persistées et hooks sont revalidées aux étapes `issue`, `consume` et `current`, y compris après un `await` et avant la requête `read.live` précédant l'effet Chromium. Il serait inexact de présenter ce chemin comme dépourvu d'epoch.

Un chemin distinct restait exposé : `PluginBrowser.tabs` autorisait `browser.tabs.list` avec quatre assertions **asynchrones**, puis attendait `host.tabs()`, sans épingler la génération de politique. Le test adversarial du véritable broker `PluginBrowser.make` a démontré deux cas **RED** : modification d'une règle enregistrée pendant l'une des assertions et révocation pendant l'attente d'inventaire. Avant G106, les métadonnées d'onglet obsolètes étaient malgré tout transmises au plugin.

## Correction bornée G106

`Permission.Service` expose au Core un numéro `browserPolicy` de génération vérifié synchroniquement. Il observe les révisions `Agent`, `PermissionSaved`, `PluginHooks` et l'epoch natif `BrowserLease`, qui augmente aussi sur les événements `Session.Permissions`, les autres événements de session et les rejets de consentement. Toute source de révision indisponible refuse la lecture. Le broker `tabs` capture cette génération **avant** les assertions, la revalide **après** les quatre assertions, puis **après** le retour asynchrone du host. Un changement du host, une génération de politique différente ou un plugin déchargé refuse le résultat ; aucun inventaire obsolète ne sort du Core.

La fonction normale `browser.tabs.list` reste disponible si l'autorité n'a pas changé ; le miroir Core-local de tab metadata et l'interdiction du RPC Desktop legacy restent inchangés. G106 n'ajoute aucun nouveau droit de lecture du DOM ni commande d'écriture.

## Preuves et risques restants

Deux tests adversariaux RED→GREEN exercent le broker réel avec des contrôles de permission simulés à attente déterministe. Un troisième test du **vrai** `Permission.Service`, lié à `PermissionSaved` et à la base de test, confirme qu'une mutation persistée invalide le `browserRead.current` d'un ticket consommé avant le prochain contrôle Core. Un événement `Session.Permissions` fait aussi progresser l'epoch observé. Les tests historiques de consommation unique `BrowserLease`, `snapshotOnce`, `read.commit` et `read.live` restent actifs.

**NO-GO production :** le Core ne possède pas de provenance de processus Electron attestée pour le premier `attach` et ne peut pas certifier l'effet Chromium. Les révisions `PermissionSaved` sont celles du processus/service courant : une écriture SQL externe sans événement de mutation ou une modification dans un autre processus ne bénéficie pas d'une invalidation transprocessus certifiée. La validité entre le dernier contrôle synchrone et une éventuelle lecture de l'interface par un autre processus ne constitue pas une transaction globale. Aucun Electron E2E, aucune disponibilité commerciale des cinq fournisseurs, aucun `navigate/click/fill/submit` WebBridge, aucune fusion ou remplacement de l'application officielle n'est revendiqué.
