# Journal durable et réconciliation opérateur (`webbridge-journal`)

Le transport natif conserve une **tentative durable par prompt** dans le répertoire privé
`WEBBRIDGE_NATIVE_JOURNAL_DIR` (un fichier `attempt-<sha256 du prompt>.json`, écrit
atomiquement : temporaire + `fsync` + `rename`). Cette mémoire est ce qui empêche un
rejeu : la tentative est écrite **avant tout effet UI**, et un retry ré-observe la même
tour au lieu de renvoyer le prompt.

Ce que le journal contient — et ne contient jamais :

| Champ | Sens |
| --- | --- |
| `turnID` | identité opaque de la tour navigateur |
| `state` | `inflight`, `uncertain`, `complete`, `abandoned` |
| `messageKey` | message assistant sélectionné pour cette tentative |
| `progress` | curseur de livraison durable : `{ seq, length, hash du préfixe livré }` |
| `scope` | identité de l'onglet autorisé : `{ tabID, generation }` |

Le **texte assistant n'est jamais écrit** dans le journal : seuls la longueur et un
digest SHA-256 du préfixe déjà livré sont persistés. Un état `complete` n'est écrit que
si une preuve de complétion a été vérifiée ; sinon l'état reste `uncertain`.

## Utilisation

```sh
# Lecture seule (aucune modification) : état des tentatives, sans texte assistant.
node bin/webbridge-journal.mjs --journal ~/.webbridge/journal

# Réconciliation explicite : l'opérateur atteste qu'une tentative provisoire
# ne doit plus jamais être réconciliée (elle ne prétend aucune complétion).
node bin/webbridge-journal.mjs --journal ~/.webbridge/journal --abandon <turnID|préfixe de clé>
```

Le répertoire peut aussi venir de la variable `WEBBRIDGE_NATIVE_JOURNAL_DIR`. La commande
exige un terminal interactif (aucun pipe), une cible **explicite** (`--abandon` sans valeur
est refusé, aucun joker), et une confirmation `YES` avant toute écriture.

## Effet d'un abandon

- la tentative reste dans le journal comme **preuve** (elle ne prétend pas avoir réussi) ;
- un prompt identique ultérieur devient une **nouvelle tour** (nouvel envoi), au lieu
  d'être réconcilié sur une tour navigateur peut-être périmée ;
- l'abandon est idempotent : relancer la commande sur une tentative déjà abandonnée ne
  réécrit rien.

## Portée (scope) et génération d'onglet

Chaque tentative enregistre l'onglet autorisé et sa **génération**. Une reprise sur un
autre onglet, ou une génération remplacée (rechargement/nouvel onglet), est **refusée**
(`scope-changed`) sans rien livrer et sans renvoyer le prompt : le texte lu
appartiendrait à une autre tour navigateur.

## Limites honnêtes

Un journal corrompu ou mal nommé fait **échouer la lecture entière** (jamais une vue
partielle qui laisserait croire qu'il n'y a rien). L'abandon ne prouve pas ce qui s'est
passé côté fournisseur : il constate seulement qu'un opérateur a décidé de ne plus
rattacher cette tentative. Aucune complétion n'est jamais inventée.
