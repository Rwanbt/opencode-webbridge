# G22 — État vérifiable des PR Draft et dépendances

Instantané au 17 octobre 2026 du dépôt `Rwanbt/opencode-webbridge`. Les références PR #84/#85/#89/#90/#91/#92/#93 ont été ajoutées au registre versionné. **9 épics, 54 user stories, 66 issues ; 0 story acceptée en production.** Chaque PR demeure **Draft**, aucun fournisseur commercial n'a été activé, aucun merge ni modification Unifia.

## Pistes empilées distinctes

- **Navigateur OpenCode officiel :** #78 → #84 (read-only, upstream v2 exact `4617210`) ; autorisation one-shot native et write non encore officiellement disponibles. Les patchs upstream sont proposés, non appliqués au Desktop de l'utilisateur.
- **Relais/journal + témoins :** #67 → #68 → #69 → #70 → #71 → #72 → #73 → #74 → #75 → #76 → #79 → #80 → #81 → #86 → #87 → #88 → #89 → #90 → #92 → #93. G19 = détecte le rollback **du journal seul** avec un témoin indépendant ; G20 = branche le témoin au banc RPC ; G21 = preuve opérateur par fichier et hash avant réconciliation.
- **Windows :** #81 → #83 → #85 ; corrections de lifecycle/preflight en branche séparée, pas encore rassemblées avec la chaîne témoin #92. Un smoke local Windows de #92 a expiré sur l'ancien lanceur 45s ; les deux CI exact SHA de #92 ont réussi (fixtures Linux + Windows), **sans** supprimer la nécessité d'une branche de convergence et d'essais répétés ciblés.
- **Conformité/adaptateurs :** #74 → #77 → #82 → #91 ; cinq profils sont **hors ligne**, avec états login manuel, reconnect, curseurs, interruptions, non-rejeu, diagnostics. Aucune page réelle ni identifiant utilisateur n'est touché. Les policies `unreviewed` sont bloquantes.

## Distinction impérative entre preuve et produit

Les preuves #90/#92/#93 montrent l'intégrité/reprise de fixtures et commandes administratives : elles ne prouvent pas une transaction browser Desktop native, une permission au bon tour ou une action site autorisée. Un vrai `read/write` sur page locale exige une primitive d'autorisation **consommée au point d'effet** par le pilote de confiance, liée à session/workspace/agent/tour/onglet/action, et un contrôle de révocation race-free. Les outils/sous-agents/Git nécessitent leur propre preuve de permission OpenCode, pas un parsing automatique de sortie web. Même lorsque ces prérequis seront disponibles, ChatGPT, DeepSeek, Gemini, Qwen et Mistral exigent des validations contractuelles indépendantes ; ne jamais confondre compte web et API d'inférence supportée.

Le contrôleur `npm run check:progress` refuse toujours les valeurs `completed` et les critères de production non vérifiés. Les versions de PR et leurs SHA sont des instantanés : toute mise à jour de branche exige une nouvelle preuve sur SHA exact avant acceptation.
