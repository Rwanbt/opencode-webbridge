# G8 — Contrat de passage des outils vers les permissions natives OpenCode

**État : contrat typé + tests locaux de non-rejeu, pas encore d'exécution d'un outil OpenCode dans une session du fournisseur web.**

## Frontière de confiance

Un texte généré par un modèle web, une réponse HTML ou une instruction trouvée dans le DOM ne doit **jamais** être interprété comme une commande terminal/Git/sous-agent. Le parseur `parseToolProposal` accepte seulement un objet **structuré** avec les champs exacts : version 1, nature `tool_proposal`, sessionID, agentID, worktreeRef, turnID, operationID et outil (nom + arguments). Il rejette tout texte/Markdown, identifiant étranger, nom non enregistré, charge JSON invalide, prototype dangereux ou demande surdimensionnée.

La politique et les capacités de chaque outil appartiennent à **OpenCode**, non au navigateur. `NativeToolHandoff` requiert une liste de noms d'outils explicitement enregistrés, le validateur d'arguments de leur schéma natif et deux callbacks provenant d'un **intégrateur de confiance** : autorisation native et exécution native. Aucun outil n'est enregistré ou exposé par le plugin de production actuel. L'autorisation d'une page ou d'un compte web ne devient jamais autorisation d'un outil local.

## Effets durables

Avant de solliciter les permissions, l'identifiant d'opération (lié à session, compte, onglet, agent et worktree) est enregistré dans le journal G6–G7. Un refus natif crée un état `cancelled`. Une autorisation vraie permet le passage à `leased` **persisté avant la moindre exécution**. En cas de retour confirmé du callback, l'état devient `settled` ; en cas d'erreur ou perte de réponse, `leased` reste **incertain** et toute nouvelle exécution est bloquée jusqu'à la réconciliation G7. Un même operationID ne peut pas être redistribué au redémarrage.

Les appels retournant un outil inconnu, un objet JSON falsifié, une autre session ou un autre worktree sont refusés avant même la demande de permission. Les tests simulent refus, erreur après effet, opération rejouée après crash, injection JSON et altération de contexte.

## Limites avant activation

Cette PR constitue une **interface interne vérifiée en isolation**, pas un tunnel prêt pour les outils. La liaison concrète aux méthodes `ctx.permission` / `ctx.tool` / `ctx.session` du SDK 2.0.29 doit prouver que la permission OpenCode est émise pour la bonne session, le bon agent, le bon outil et le bon worktree ; aucune fonction `nativeAuthorize` factice ne doit être utilisée en production. La continuité du contexte entre modèles web et sessions OpenCode, l'adaptation vers des appels outils réellement structurés, les résultats progressifs, la protection DLP et l'isolation multi-agent E2E restent à implémenter.

Cette passerelle ne doit être activée **qu'après** l'accès autorisé au navigateur et la vérification des conditions du fournisseur. Les cinq services restent désactivés.
