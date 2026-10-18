# ADR 0076 — Identité immuable de tab et reconnexion sans confusion de principal

## Contre-exemples RED

Le registre de session permettait de lier le **même onglet, compte et session**
à un fournisseur différent (`qwen` puis `gemini`) sans invalider la liaison.
Le retour de `bind()` partageait une référence mutable avec le registre : un
appelant pouvait en modifier `accountRef` ou `providerID` malgré `readonly`
TypeScript. Une inscription idempotente renouvelait aussi `boundAt` et
masquait l'âge réel de la liaison.

Le `ReconnectionVerifier` acceptait un principal avec identifiants manquants,
un `now` invalide ou un `maxAgeMs=NaN` : une comparaison avec NaN ne prouve
jamais l'expiration. Son spread objet pouvait exécuter un getter non fiable.
Les six tests runtime ajoutés ont reproduit ces défauts avant correction.

## GREEN

- Le registre refuse le changement silencieux de fournisseur à portée égale,
  refuse les identifiants hors catalogue, copie exclusivement des descripteurs de données propres, fige les liaisons
  exposées et conserve la date originale d'un bind identique.
- La reconnexion exige les cinq identifiants opaques du plugin/connexion/session,
  exactement, des timestamps/âges entiers finis positifs et l'absence de
  champs supplémentaires ou de getters. Le résultat est `invalid-input` et
  **aucune autorité n'est créée** si une donnée manque.
- Teste les variantes d'identité, mutation JS, renouvellement d'âge, windows
  de temps malformées et getter sans exécution, sans navigateur commercial.

## Limites / NO-GO

Ces composants sont des **contrôles locaux de cohérence** et ne prouvent
ni l'attestation du premier processus Electron ni l'authenticité cryptographique
de l'appelant. Un objet JavaScript `Proxy` de même realm peut déclencher des
traps pendant l'introspection ; la frontière réelle doit parser du JSON
et recevoir les identités d'un hôte native-owned. Le registre reste volatil :
aucune garantie de continuité après restart sans G121/G122 + authentification.

Ne pas convertir cette correction en `nativeDesktopElectronE2E=true`.
Écritures WebBridge OFF ; 0/5 fournisseurs et 0/54 stories production.
OCDX exclu, aucun fichier OpenCode officiel modifié.
