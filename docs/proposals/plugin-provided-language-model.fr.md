# Proposition upstream — modèle d'inférence fourni par un plugin externe

Statut : **proposition**, pas un ADR ; aucun numéro ADR n'est revendiqué. Aucun patch
upstream n'est produit ici. Le correctif navigateur `4617210` est un sujet distinct.

## Contexte

WebBridge doit exposer des modèles natifs adossés à des sessions web déjà authentifiées,
sans clé API d'inférence. L'ADR 0123 a établi que le SDK public
(`@opencode/plugin@2.0.29` + CLI officiel `@opencode/cli@2.0.32`) permet d'enregistrer un
fournisseur et de sélectionner ses modèles, mais que le terminal DOM n'est pas certifié.
Cette proposition documente la surface réellement observée, la limite terminale démontrée,
et les demandes minimales pour qu'un modèle « non autoritaire » soit représentable
honnêtement.

## Les trois voies évaluées (preuves exécutables)

1. **Route OpenAI-compatible (legacy).** `package: '@opencode/ai/providers/openai-compatible'`
   + `settings.baseURL` en boucle locale fonctionne (SSE, `[DONE]`). Mais `finish_reason`
   est validé strictement : une valeur non standard (`webbridge_uncertain`) produit
   `provider.unknown`, puis des tentatives répétées. Impossible d'y exprimer « incertain ».

2. **Hooks `aisdk` sans préfixe.** `ctx.aisdk.hook('sdk' | 'language')` s'enregistre sans
   erreur mais n'est **jamais invoqué** pour un provider plugin dont `package` n'est pas
   préfixé `aisdk:` ; la route legacy est utilisée et ignore les hooks.

3. **Préfixe `aisdk:` + module d'ancrage.** Le cœur exécute d'abord un hook interne de
   chargement qui interprète `package` comme un module chargeable (`file://…`, specifier npm
   installé/caché, chemin résolu depuis le répertoire de travail), importe le module et
   appelle le premier export dont le nom commence par `create`. Si ce chargement échoue,
   l'erreur interrompt la boucle de hooks **avant** les hooks du plugin. S'il réussit, les
   hooks du plugin sont invoqués et `language` peut substituer un `LanguageModelV3`
   in-process.

L'ordre est déterminant : le chargement d'ancrage précède les hooks du plugin. Un plugin
qui fournit son propre modèle doit donc livrer un module d'ancrage valide (même minimal),
sans quoi ses hooks ne sont jamais atteints.

## Ce qui fonctionne (démontré)

- `ctx.provider.transform(editor.add({ info, models }))` (API promise) enregistre le
  fournisseur et ses modèles ; `opencode run --model provider/model` les sélectionne.
- Module d'ancrage `aisdk:file:///…/provider.mjs` exportant une factory `create*` :
  appelée par le cœur avec les options du plugin (`{ name }` observé pour `settings: {}`).
- Hook `ctx.aisdk.hook('language')` (API promise) **persistant** : il fournit le modèle
  effectif. Le texte du modèle est streamé dans la session officielle, en un tour unique,
  avec `finish: "stop"` et un code de sortie 0, sans transport HTTP.
- `finishReason.raw` et `providerMetadata` sont conservés dans les parties de session.
- Le module d'ancrage est chargé **paresseusement, à l'initialisation du modèle** : il doit être
  un point d'entrée du paquet publié. Un `tsconfig` de publication qui ne compile que le graphe
  d'imports l'omet (fichier jamais atteint par un `import`) et l'initialisation échoue alors avec
  `provider.no-route — Cannot initialize <provider>/<model>: Cannot find module …`. Constat
  reproductible sur Linux et Windows ; ce n'est pas une différence de plateforme.

## Limite démontrée (NO-GO exécutable)

`finishReason.unified = 'other'` est normalisé en `"unknown"` par la couche session
(`unified === 'other' ? 'unknown' : unified`). Le tour est alors refusé avec
« The provider response ended with an unknown finish reason » (classification
`incomplete-stream`) et réessayé. Il n'existe donc **aucun état terminal « UNCERTAIN »
de première classe** : seuls `stop`, `length`, `content-filter`, `tool-calls`, `error`
sont acceptés, et `stop` affirme une complétion normale.

Conséquence pour WebBridge : un terminal DOM observé mais non attesté ne peut pas être
représenté honnêtement. Soit on affirme `stop`, soit le tour échoue. Le `raw` et les
métadonnées permettent de conserver la trace, mais pas de terminer proprement.

## Demandes minimales

1. **Contrat « provider module ».** Documenter et garantir : préfixe `aisdk:`, résolution
   (`file://`, specifier npm, chemin), export `create*`, ordre d'exécution (chargement
   avant les hooks), et chargement paresseux à l'initialisation du modèle (le module doit donc
   être livré comme point d'entrée du paquet). Alternative : une API publique dédiée
   (`ctx.aisdk.provider({ factory })`).
2. **Terminal non autoritaire.** Accepter `unified: 'other'` sans le convertir en
   `unknown`/erreur, ou ajouter une raison de fin explicite (`uncertain` /
   `non-authoritative`) exposée via l'API et l'UI.
3. *(Optionnel)* Exposer les capacités du modèle (badge « non autoritaire ») et documenter
   `small_model` : le cœur adresse sinon la génération de titre au même modèle, donc au
   navigateur.
4. *(Optionnel)* Documenter la persistance des hooks selon l'API (promise vs Effect) et
   l'ordre des hooks.

## Hors périmètre

- Aucun patch du cœur distribué ; proposition indépendante.
- L'attestation OS/Desktop et la révocation atomique Core/Chromium restent des limites
  distinctes (non résolues ici).

## Preuves exécutables

- `test/native-web-models-cli.test.ts` (paquet npm brut de ce dépôt, CLI officiel 2.0.32) :
  dormant par défaut sans activation ; provider + modèle natifs sélectionnables ; un tour servi
  par le modèle du plugin avec **un seul** tour navigateur (l'appel auxiliaire de titre ne part
  jamais) ; terminal non prouvé enregistré comme **erreur** (jamais `stop`) ; absence de session
  => refus explicite, aucune sortie inventée.
- `test/native-provider-module.test.ts` (job CI Linux, CLI officiel 2.0.32) :
  GREEN — module d'ancrage + hook `language`, tour propre `finish: "stop"` ;
  RED — `finishReason: 'other'` refusé comme flux incomplet, reprise constatée.
- Sonde locale Windows hors dépôt (mêmes conclusions, CLI officiel 2.0.32) : route
  legacy avec `finish_reason` inconnu, hooks non invoqués sans préfixe, module d'ancrage
  + hook substituant le modèle, terminal `other` refusé.
