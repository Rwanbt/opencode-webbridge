# G1 — Preuve d'inférence native OpenCode 2.0.29

Date : 17 octobre 2026. Code de validation isolé : `scripts/smoke-native-provider.mjs`.

## Résultat local observé

Commande exécutée dans le worktree indépendant `D:\App\opencode-webbridge-g1` :

```powershell
npm run smoke:native
```

Sortie vérifiée :

```text
OpenCode local G1 fixture smoke: exit=0, HTTP requests=2, reply-observed=true
```

OpenCode 2.0.29 exécute réellement une requête de modèle par son mécanisme natif. Le plugin de **test exclusivement** `src/testing/native-fixture-plugin.ts` enregistre `webbridge-fixture/webbridge-native-fixture` avec le runtime officiel `@opencode/ai/providers/openai-compatible` ; un serveur HTTP synthétique hébergé exclusivement sur `127.0.0.1` fournit l'unique réponse `WEBBRIDGE_NATIVE_FIXTURE_OK` (HTTP normal et SSE). Une session native OpenCode a effectivement généré cette réponse, sans service d'IA externe et sans compte web.

Le serveur a observé deux requêtes pendant le smoke ; ce résultat prouve l'inférence, **pas** une garantie de livraison exactement une fois ou d'absence de retries par OpenCode. Le journal d'effets du transport navigateur n'existe pas encore.

## Isolation et limites

- Profil, données, caches et config temporaire dédiés dans un nouveau sous-dossier de `%TEMP%` ; suppression à la fin.
- Environnement enfant construit depuis une petite liste de variables système. Aucune clé/tokèn hérité de la session principale (API, GitHub, compte, etc.).
- Plugin de production `src/index.ts` reste strictement inactif. L'enregistrement d'un modèle fictif n'est effectué **que** par le plugin de test et nécessite les variables `WEBBRIDGE_FIXTURE_ENABLE=1` et `WEBBRIDGE_FIXTURE_URL=http://127.0.0.1:<port>/v1`.
- Aucun navigateur, fournisseur web réel, cookie ou jeton de session n'est interrogé. Les cinq adaptateurs web restent tous bloqués par `ProviderGate`.
- Le smoke nécessite OpenCode 2.0.29 présent sur `PATH` (ou `OPENCODE_BIN` vers son binaire). Un job CI installe explicitement `@opencode/cli@2.0.29` pour éviter les variantes installées sur le poste utilisateur.

## Découverte importante sur le chargeur de plugins

Un premier test a donné `provider.no-route` (aucune requête HTTP) et les journaux ont montré `configured plugin path must be a directory` lorsque le tableau `plugins` ciblait des fichiers `.js` par `file://`.

Le même plugin fonctionne sur OpenCode 2.0.29 lorsque `plugins` cible des **répertoires de packages** avec `package.json` contenant un `main` valide. Cela nuance les exemples de chemins de fichiers figurant dans la documentation publique, et donne le format à privilégier pour cette version précise. Le workaround est contenu dans le banc de smoke ; aucune configuration globale de l'utilisateur n'a été écrite.

## État du gate G1

**Réussi partiellement** : exécution du runtime d'inférence, provider et plugin de test effectifs sur le CLI v2.0.29.

**Encore non validé** : pilotage du navigateur intégré par le plugin ; liaison de sessions et comptes web réels ; permission contractuelle de l'automatisation pour chacun des cinq services ; protocole d'outils complet et reprise de session. Le SDK 2.0.29 ne possède pas `ctx.browser` documenté. Ne pas déclarer G1 entièrement vert avant une preuve de navigateur.

## Prochaines actions

1. Vérifier dans le navigateur de bureau intégré les APIs pouvant relier `tabID`, `sessionID` et autorité d'un provider ; documenter le chemin supported ou une extension OpenCode Core nécessaire.
2. Rendre `BrowserPort` accessible via ce chemin, sans export d'authentification.
3. Implémenter le `ModelTransport` commun et le journal durable des effets avant toute tentative réelle d'appels d'outils.
4. Autoriser les adaptateurs uniquement après revue technique et des conditions applicables à chacun.
