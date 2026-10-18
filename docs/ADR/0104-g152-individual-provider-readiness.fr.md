# ADR 0104 — Activation individuelle et vérification technique des cinq adaptateurs

**Statut : correction de cadrage et de contrats, activation web non encore prouvée.**

## Décision

WebBridge cible une utilisation personnelle des cinq services web du catalogue.
La sélection d'un adaptateur est volontaire, indépendante pour chaque service
et réversible. Son éligibilité dépend de l'option explicite de l'utilisateur,
des capacités observées par des tests, de l'origine exacte et de la situation
propre au service. Une simple déclaration de capacités ne suffit jamais.

Les métadonnées historiques de revue ne constituent pas un mécanisme
d'exécution, un secret ni une identité de compte. Le contrôle technique
`isAdapterUsable` vérifie `approved`, la décision individuelle `permitted`,
et les capacités `textInput/textOutput/streaming` effectivement vérifiées.
L'étape suivante `evaluateGate` continue à exiger un transport, un navigateur,
une connexion de session et un consentement d'outil réellement valides.

Le validateur documentaire accepte une revue `permitted` et un choix
utilisateur cohérents pour **un fournisseur seulement**, tout en refusant
les origines falsifiées ou appartenant à un autre fournisseur. Cela ne
publie pas de modèle non vérifié et ne modifie pas les permissions natives.

## Tests et limites

Les cinq identités exactes ChatGPT, DeepSeek, Gemini, Qwen et Mistral sont
testées en positif pour le contrat déclaratif *avec preuves techniques
injectées*, puis en négatif pour session/transport absent, capacité
non vérifiée, absence de choix utilisateur et état restreint.
Les documents et tests antérieurs sont réconciliés sans rétrovalider
les fixtures en production.

Aucune conversation authentifiée avec ces cinq services n'a été démontrée
par ce lot, aucun secret n'est lu, aucune écriture ni action DOM n'est
activée et aucune instance officielle OpenCode n'est modifiée.
Les indicateurs de livraison restent 0/5 fournisseurs web opérationnels,
0/54 stories acceptées, Desktop Electron non démontré.
