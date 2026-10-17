# G13 — Traçabilité des 54 stories et 66 issues

Le registre versionné [`planning/progress.json`](../planning/progress.json) est un **instantané de preuve** au 17 octobre 2026, pas un tableau déclarant l'application terminée. Il reprend chacune des 54 user stories du plan global avec son issue GitHub, un état prudent, l'état *non accepté en production* de chaque critère et les références des PR Draft qui apportent des pièces de preuve.

La matrice couvre **9 épics, 54 stories et 66 issues** (9 épics + 54 stories + 3 jalons historiques). Le contrôleur `npm run check:progress` compare les identifiants à `backlog.json`, les numéros d'issues à `issue-map.json`, les nombres de critères d'acceptation et les références de PR aux SHA enregistrés. Il refuse toute story absente, référence inconnue, statut prétendument terminé, ou activation fictive d'un fournisseur commercial.

Les valeurs de critères sont volontairement distinctes : `unverified` (aucune preuve suffisante), `fixture-evidenced` (une fonctionnalité isolée est démontrée hors compte réel), `documentation-evidenced` (décision/étude documentée), `blocked` (condition externe encore bloquante). **Aucune n'est une validation de production** ; les PR sont toujours Draft et non fusionnées. L'arrivée d'une nouvelle PR ou d'un nouveau SHA impose une mise à jour explicite et revue de cet instantané avant d'en tirer un état de livraison.

## Périmètre restant critique

Le SDK `@opencode/plugin@2.0.29` ne donne pas de `ctx.browser` direct ; les appels navigateur de première partie appartiennent à OpenCode Desktop/Code Mode. La proposition de frontière native est à soumettre à upstream ou à vérifier contre un point d'extension officiellement autorisé. Les cinq services web grand public sont tous désactivés selon la revue des conditions datée du 17 octobre 2026. Les outils/Git/sous-agents demeurent des contrats et fixtures tant que l'intégration native autorisée, les permissions et les essais E2E correspondants ne sont pas réellement prouvés.

La CI Linux/Windows représente seulement une preuve sur les modèles fictifs, le RPC et Chromium local, et ne garantit pas l'absence d'intermittence sur toutes les machines. Chaque gate T0–T5 doit être contrôlée indépendamment avant release stable.
