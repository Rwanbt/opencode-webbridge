# G5 — Premier navigateur réel dans le parcours natif OpenCode

**17 octobre 2026 — test E2E local réussi sous Windows.**

## Ce qui fonctionne

Le nouveau script `npm run smoke:page` démarre une instance OpenCode **2.0.29** et son fournisseur fictif. Le modèle délègue ses requêtes par `BrowserPort` et RPC à un compagnon de test, qui ouvre **une véritable instance Chromium headless** dans un profil neuf et isolé.

Le compagnon charge une unique page HTML de chat sur `127.0.0.1` (port éphémère), remplit réellement une zone de saisie, clique sur le bouton d'envoi et attend que la réponse soit affichée dans le DOM. Cette réponse traverse ensuite la même pile RPC/inférence jusqu'à la session native OpenCode.

Résultat local observé : `G4 native model-to-RPC-to-real-local-browser E2E PASS: HTTP=3, companionJobs=2, RPC=60, response=true`. Le nombre d'appels n'est pas une garantie d'exécution exactement une fois des demandes de génération.

## Reproduction

```sh
npm ci
npx playwright install --only-shell chromium
npm run smoke:page
```

La CI Linux installe Chromium headless et les dépendances système, puis réalise la même démonstration. La version Playwright est figée dans le lockfile npm.

## Périmètre de sécurité

- **Aucun navigateur connecté au compte de l'utilisateur.** Nouveau contexte Chromium sans cookies, extensions ni sessions personnelles.
- Page et requêtes de navigation autorisées uniquement vers une URL exacte `http://127.0.0.1:<port>/` ; refus explicite des sites externes et autres chemins.
- Serveur HTML local lié à `127.0.0.1` avec vérification du `Host`, CSP restrictive, pas de connexion script sortante ni de ressources tierces.
- Le navigateur lit et écrit seulement des éléments de la page fictive, sans collecte de tokens ou accès aux plateformes commerciales.
- RPC de test et serveur d'inférence conservent chacun leurs secrets aléatoires et leurs permissions distinctes, conformément à G3–G4.
- La commande n'est pas un installateur du navigateur intégré OpenCode et ne modifie aucune configuration globale d'OpenCode.

## Ce qui n'est pas encore prouvé

Playwright utilise son propre Chromium ; **la webview OpenCode Desktop n'est toujours pas pilotée**. Le SDK `@opencode/plugin@2.0.29` expose `rpc`, mais aucune méthode publique de contrôle de sa webview. Un module compagnon Desktop explicitement autorisé, un point d'extension navigateur officiel ou une modification d'OpenCode Core sera nécessaire pour ce cas.

Les cinq adaptateurs ChatGPT, DeepSeek, Gemini, Qwen et Mistral sont inactifs. Leur accès par comptes web implique une revue indépendante des conditions applicables, du consentement utilisateur, des contrôles d'origine, de l'idempotence et des effets d'outils avant tout usage réel.
