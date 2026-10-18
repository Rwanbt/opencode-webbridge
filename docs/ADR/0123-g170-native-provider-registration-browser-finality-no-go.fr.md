# ADR 0123 — G170, modèle natif externe : SDK possible, ChatGPT Web non qualifié

## Décision

La surface publique **`@opencode/plugin@2.0.29`** permet `ctx.provider.transform(editor.add({ info, models }))` afin d'enregistrer un fournisseur et ses modèles dans le moteur OpenCode officiel. Le hook `ctx.aisdk.hook('language', ...)` reçoit un modèle et peut substituer une implémentation `LanguageModelV3`; `ctx.model.transform` ne crée pas de nouveaux fournisseurs. Aucun fork ou recompilation du CLI n'est nécessaire pour le mécanisme de découverte et de sélection. L'enregistrement est donc **techniquement faisable**.

Le nouveau `src/runtime/g170-native-registration.ts` fournit une véritable entrée de plugin externe, indépendante du root distribué, et activable **uniquement** avec `WEBBRIDGE_G170_OFFLINE_TEST=1`, une seconde confirmation littérale, un jeton de 256 bits et un endpoint strict `http://127.0.0.1:<port>/v1`. Le fournisseur `webbridge-g170-offline-test` expose seulement `webbridge-native-fixture`, nommément synthétique. Son transport OpenAI-compatible sur boucle locale offre une réponse SSE et `[DONE]` générés par une **fixture contrôlée**. Ce test vérifie la compatibilité du SDK / CLI, **pas l'inférence ChatGPT web**. Il ne doit jamais être publié comme modèle commercial.

## Démonstration native et limitations

La CI Linux installe le CLI **officiel `@opencode/cli@2.0.32`** dans le workspace jetable, empaquette puis installe le module G170 dans un profil isolé, observe le plugin et le fournisseur dans `/api/plugin` et `/api/provider`, sélectionne `webbridge-g170-offline-test/webbridge-native-fixture` via le CLI officiel et vérifie les fragments SSE + `[DONE]` de la fixture. Le chemin de production `src/index.ts` reste inchangé. Aucun profil personnel, compte commercial, navigateur authentifié, upstream ou `main` n'est touché.

**NO-GO fournisseur web réel :** G166 retourne uniquement `terminal.status='uncertain'`, après consentement et même si une réponse DOM progressive apparaît. Un DOM mutable ne certifie ni que la réponse correspond au prompt soumis, ni sa fin, ni la provenance de la permission OS/Desktop. `g170PersonalFinalityGate` refuse par construction toute promotion de ces candidats en fin d'inférence `stop`. Le SDK sait déclarer et sélectionner un modèle, mais ne fabrique pas la preuve manquante. Exposer un modèle ChatGPT (ou DeepSeek, Gemini, Qwen, Mistral) à ce stade serait mensonger. **0/5 fournisseurs réels qualifiés**, aucune route native de production ajoutée.

## Conditions d'évolution

Un futur hôte devra fournir un contrat **fiable et vérifiable** pour : attachement et identité utilisateur, autorisation par action, correspondance univoque prompt/réponse, progression attribuée, ACK de fin authentifié, persistance et résolution de l'incertitude sans rejeu. À ce moment seulement, brancher un véritable `LanguageModelV3` derrière un modèle commercial sera recevable. Toute preuve issue uniquement d'un `data-testid`, d'un texte visible ou d'une absence de nouvelles modifications DOM reste insuffisante.
