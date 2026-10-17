# G12 — Streaming réel du DOM HTML local vers RPC OpenCode

G11 émettait un événement RPC `progress` à partir d'une réponse déjà entièrement reçue. Ce test G12 vérifie une progression plus réaliste : **la page Chromium locale affiche d'abord du texte partiel, puis un texte final**, et le compagnon lit chaque transition distinctement avant d'envoyer les deux fragments par RPC à OpenCode 2.0.29.

L'interface HTML de test passe explicitement par `pending → streaming → finished`. Le client Playwright attend le premier état, vérifie l'identité textuelle et émet le premier fragment, puis confirme explicitement la progression par un bouton de fixture avant que la page puisse afficher l'état terminal. Cette barrière évite de manquer la fenêtre `streaming` si Playwright ou le runner CI sont momentanément ralentis. Le client calcule ensuite le suffixe de la sortie terminale et l'émet séparément. `monotonicDelta` refuse un DOM qui se raccourcit, se réécrit ou dépasse les bornes plutôt que de traiter une révision comme du texte supplémentaire. Le relais refuse aussi tout nouvel envoi pendant cette progression, et la réponse finale doit correspondre à la concaténation exacte des fragments observés.

## Preuve reproductible

```sh
npm ci
npx playwright install --only-shell chromium
npm test
npm run smoke:page
```

Le smoke échoue si le nombre de fragments **réellement lus du DOM** est inférieur à deux par tâche prise en charge. Le job CI exécute le même parcours sur Ubuntu et Windows ; les délais et erreurs restent visibles sans skip ni reprise implicite. Les tests unitaires couvrent les redessins non monotones et les événements RPC mal ordonnés.

**Limitations :** le site est une page HTML synthétique du projet, pas un service ChatGPT/DeepSeek/Gemini/Qwen/Mistral. Les véritables interfaces peuvent réécrire une réponse pendant la génération, changer de structure ou demander une interaction humaine ; dans ces cas l'adaptateur doit passer à `unavailable/uncertain` sans effet ni répétition automatique. Ce test ne prouve ni le contrôle de la webview intégrée d'OpenCode Desktop ni les permissions des fournisseurs commerciaux.
