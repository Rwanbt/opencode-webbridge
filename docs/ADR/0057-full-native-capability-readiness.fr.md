# ADR 0057 — Readiness complète du fournisseur, jamais déduite des seules réponses texte

## Défaut et test RED

Le garde-fou `evaluateGate` traitait un adaptateur comme « ready » malgré
`streaming=unsupported` ou `tools=unknown`, alors que l'objectif WebBridge
requiert **streaming progressif et outils natifs**. Il acceptait aussi un
identifiant de fournisseur forgé dès lors que ses booléens avaient été réglés.
Un test négatif runtime a reproduit `ready:true` pour cette configuration.

## Décision GREEN

La readiness complète exige un identifiant du catalogue des cinq fournisseurs,
des contrôles contractuel, navigateur, transport, connexion manuelle et consentement
validés, et `supported` pour input, output, streaming et outils. `unknown`
ou `unsupported` sont refusés. Cette fonction reste une **évaluation de
métadonnées**, pas une autorité indépendante sur les valeurs annoncées.

## Vérification

RED 1 test échoué avant correction ; GREEN 3/3 après correction avec cas
inconnus/non supportés streaming/outils, fournisseur forgé, build TypeScript,
backlog 9 épics / 54 stories et contrôle du diff.

## Limites / NO-GO

Un appelant qui fabrique tout un objet `ProviderGate` `permitted/verified`
peut toujours tromper cette simple fonction ; les preuves doivent provenir
d'une autorité native non contrôlée par le contenu web. Aucun des cinq
fournisseurs n'a cette preuve ni une autorisation contractuelle établie ; ils
restent désactivés. Aucune reconnaissance de session commerciale, aucun outil
exécuté, aucun test Electron/Desktop véritable, aucune preuve Core↔Chromium
atomique. 0/5 fournisseur réel, 0 story production, WebBridge writes OFF.
OCDX exclu définitivement. Aucun changement à OpenCode officiel installé.
