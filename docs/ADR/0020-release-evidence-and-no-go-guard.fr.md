# ADR 0020 — Preuves de progression et verrou NO-GO

`planning/progress.json` recense 9 epics, 54 stories et 66 issues (63 liees au backlog et trois transversales #1-#3). Les 13 PR #142-#154 indiquent le SHA exact observe sur GitHub et le nombre de checks verts. Toutes ces preuves sont *partielles* : ni les tests Bun, ni Chromium local ne prouvent une integration Electron Desktop officielle.

`scripts/check-progress.mjs` tourne en CI et compare les totaux au backlog et a l'issue-map. Il refuse les doublons, SHA malformes, faux nombres de checks et promotions implicites en production. Le test negatif modifie des preuves et des gates dans des fichiers temporaires et exige un echec. Ce script ne contacte pas GitHub : les SHAs sont un instantane audite, non une nouvelle confirmation de l'etat externe.

Le contrat interdit actuellement toute acceptation de production, tout fournisseur commercial actif, les writes WebBridge, et toute affirmation de garantie atomique Core vers Chromium ou d'E2E Electron. Ces limites doivent etre levees uniquement apres preuves completes et revue humaine, sans contourner le validateur. Les travaux partiellement attestes restent ouverts : ne pas les compter arbitrairement comme termines ou planifies.
