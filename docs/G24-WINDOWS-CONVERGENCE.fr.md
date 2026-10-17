# G24 — Raccordement des correctifs Windows éprouvés à la chaîne témoin

Cette PR Draft récupère **par cherry-pick non destructif des commits existants #83** les correctifs de résolution de l'exécutable OpenCode 2.0.29 et du lanceur natif Windows, sur la branche distincte #97 (journal témoin G19/G20, preuve opérateur G21, intentions d'outils G23). Elle ne fusionne pas #83 ni #85 et ne touche pas Unifia. Elle prépare une convergence dont la prochaine petite PR doit importer les correctifs de supervision/preflight de **#85**.

Le comportement natif Windows déjà acquis n'est pas réécrit : les deux commits `f57a927`, `7a8326f` sont conservés et les 62 tests unitaires/intégration de cette branche passent. Le contrôle `npm run check:progress` maintient zéro story acceptée en production. L'ancienne intermittence native ne sera considérée comme atténuée dans **cette chaîne empilée** qu'après import de #85 et tests exact SHA (y compris le G20 witness smoke avec vrai CLI OpenCode et page de chat locale).

Tout restera en Draft et limité aux fixtures locales. La validation OpenCode Desktop, la consommation atomique des droits et les comptes commerciaux restent des travaux séparés.
