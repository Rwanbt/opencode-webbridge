# G10 — Vérification Windows indépendante

La CI des premières PR n'exécutait les smokes OpenCode 2.0.29 que sous Ubuntu. Pourtant, plusieurs exécutions locales Windows ont affiché des délais d'inférence dépassés, et un échec de suppression des répertoires éphémères (`EBUSY`) après une réponse modèle réussie. Il faut donc **une preuve Windows au commit exact**, et non déduire la compatibilité de Linux.

La tâche GitHub Actions `Windows native fixtures (OpenCode 2.0.29)` effectue, sur un runner Windows neuf : installation Node 22, dépendances épinglées, typage et tests, CLI OpenCode explicitement 2.0.29, puis les 5 parcours `smoke:native`, `smoke:browser`, `smoke:rpc`, `smoke:e2e`, `smoke:page` après installation du seul Chromium headless Playwright. Les profils OpenCode, serveurs et journaux restent isolés, aucun compte web commercial n'est utilisé.

**Critère de réussite :** job Windows complet `SUCCESS` sur le SHA de la PR, sans skip, relâchement des assertions ni ré-exécution d'actions externes. En cas de timeout ou `EBUSY`, le résultat doit rester FAIL ; examiner processus enfants, délais Windows, ordre de fermeture et fuites de handle. Des reruns seuls ne constituent pas une correction déterministe. Le parcours Ubuntu reste conservé en parallèle.

Un succès ici qualifiera uniquement la **compatibilité des fixtures** : pas l'accès au navigateur intégré, ni l'usage effectif des cinq chats commerciaux, ni les outils réels avec sous-agents/Git. La phase finale devra inclure une matrice Windows/macOS/Linux et des essais natifs autorisés.
