# ADR 0016 — Deltas du relais jusqu'au flux SSE du modèle OpenCode de test

## Décision et portée

`streamBrowserTurn` étend le port `BrowserPort` par un `AsyncGenerator<string>` qui consomme et valide les événements de lecture successifs, sans répéter `submit`. Chaque lot est vérifié (identité `turnID`, séquence, taille, terminal en dernière position) **avant** de livrer le moindre fragment de ce lot au consommateur. `exchangeBrowserTurn` reste un collecteur rétrocompatible qui partage exactement cette validation.

Le fournisseur **strictement local** `browserFixtureStreamResponder` traduit chaque fragment en delta du serveur de test OpenAI-compatible `openFixtureServer`. La réponse HTTP SSE peut transmettre le premier delta pendant que les suivants ne sont pas encore connus. Le mode JSON non streamé continue à agréger les fragments sous les mêmes limites. Le serveur publie `[DONE]` exclusivement après la fin valide de l'itérateur; une erreur postérieure à un fragment ferme la connexion, sans statut terminal mensonger ni restitution de l'erreur interne à un site distant.

## Preuves

- Test déterministe du générateur : deux fragments sont consommables individuellement **avant** `complete`, et la requête n'est soumise qu'une fois.
- Test HTTP : le client reçoit le premier événement SSE avant que le second ne soit libéré; le compteur de frames et le signal terminal sont vérifiés.
- Test négatif : un itérateur qui échoue après un texte partiel provoque l'interruption du flux SSE sans `[DONE]` et sans divulguer son exception interne.
- Smoke réel **CLI OpenCode modèle de test → RPC authentifié → page locale Chromium → deltas SSE** : plusieurs fragments par tour parviennent au serveur fournisseur, avec résultat final attendu. Les unités ou smokes ne sont jamais présentés comme preuve d'Electron Desktop ou de fournisseur commercial.

## Sécurité / NO-GO

Le contenu provenant de la page reste des **données non fiables**, jamais une instruction directe de terminal, Git, fichier ou outil; ce lot ne câblait aucun broker d'effets. Un consommateur de deltas peut voir un texte partiel avant que le tour soit confirmé : après interruption, son issue demeure **incertaine** et aucun replay automatique n'est permis. La journalisation durable et l'idempotence couvrent les tours de fixture suivant leurs preuves précédentes, pas un commit atomique Core ↔ Chromium.

Le chemin complet ne traverse **pas** l'Electron Desktop officiel, ni une session réelle ChatGPT, DeepSeek, Gemini, Qwen ou Mistral. `src/index.ts` de production reste inerte; aucune clé API d'inférence commerciale ni extraction de cookies. Les écritures WebBridge (`navigate`, `click`, `fill`, `submit`) restent désactivées jusqu'à preuve atomique. Les PR natives épinglées au commit officiel `4617210822bdbb31e5749751afbfb4584ccedac8` sont inchangées dans ce lot. Statut : **0/5 fournisseurs opérationnels, aucune acceptation production**, aucune fusion.
