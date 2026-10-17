# ADR 0017 — Couverture CI bornée des fragments de fixture Linux / Windows

## Motif

G64–G66 avaient des tests GitHub et des smokes OpenCode CLI+Chromium positifs, mais le nouveau script `smoke:dom-rpc` (trois fragments DOM réellement observés, arrêt incertain, interdiction de replay) n'était **pas** appelé dans la CI. La suite Windows était particulièrement sensible à la consommation mémoire historique `0x800705AF`. Une répétition de Chromium/Electron à chaque nouvelle PR Windows n'est pas justifiée par cette seule vérification du protocole.

## Décision

- Ajouter `npm run smoke:dom-rpc` à l'unique job Linux existant qui installe déjà Chromium : réutiliser le téléchargement navigateur, ne pas créer de profil ou job supplémentaire.
- Ajouter un job **Windows léger sans navigateur** sous Node 22 : installation figée sans scripts, compilation TS et quatre modules de tests RPC/streaming. Le contrôle couvre séquences, compte/session, secrets, anti-rejeu, curseurs, SSE avant terminal et arrêt après fragment sans faux `[DONE]`. Pas d'Electron, ni de lancement OpenCode CLI/Chromium sur Windows pour ne pas épuiser le hôte.
- Conserver les deux `native-fixture-smoke` et `upstream-v2-browser-patch` Linux existants. Aucun rerun des anciennes CI vertes.

## Limites de preuve

Un job Windows vert ici démontre uniquement que ces contrats offline compilent et s'exécutent sous Windows; il **ne certifie pas le GUI Electron/Desktop officiel** et ne remplace pas un smoke natif Windows avec protocole V6. G67 n'active aucun fournisseur commercial, n'étend aucune permission d'écriture, et ne prétend pas prouver l'atomicité entre `Permission.Service.browserRead`, `read.commit` et effet Chromium. Les blocages restent ouverts : principal de transport `attach`, snapshot interprocessus, outils Git/terminal/sous-agents réels, compte fournisseur et conformité. 0/5 commercial opérationnel, 0 production accepté, aucune fusion.
