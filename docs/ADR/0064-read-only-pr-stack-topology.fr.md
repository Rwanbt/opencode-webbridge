# ADR 0064 — Audit non destructif du graphe des PR Draft WebBridge

## Problème

Les incréments natifs, offline et Desktop sont publiés sur des bases
différentes, parfois avec plusieurs descendants. Une collection de CI vertes
ne prouve ni qu'une PR dépend de la bonne branche ni qu'une version consolidée
pourrait être distribuée sans résoudre ses dépendances.

## Décision

`scripts/pr-stack-audit.mjs` interroge **en lecture seule** les métadonnées
`gh pr list` ou accepte un fichier JSON de test. Il exige :

- chaque numéro de PR depuis #67 présent dans la plage observée, HEAD SHA exact
  au format 40 hex, PR Draft et noms de références admissibles ;
- une seule racine #67 vers `main`, des parents identifiés parmi les HEAD,
  sans doublon ni cycle ;
- production d'une liste de branches terminales, de forks et de profondeur
  maximale. Ces sorties sont de la topologie, pas des décisions de merge.

`npm run check:pr-stack` exécute des tests adversariaux dans GitHub CI ;
le lancement de `node scripts/pr-stack-audit.mjs` lit la topologie publique
actuelle sans écrire sur le dépôt GitHub ou modifier des PR.

## Preuve et limites

Quatre tests ciblés positifs/négatifs : racine unique, fourches, cycle,
parent manquant, plage trouée, doublons, SHA forgé et état non-Draft.
Sur les PR ouvertes au moment du contrôle local : #67–#190, 124 Draft,
une racine, 20 branches terminales, profondeur maximale 48.

**NO-GO :** l'outil ne prouve pas que les Git commits sont ancêtres réels,
que les modifications entre branches sont compatibles, que la CI est verte
ou que des stories sont acceptées. Il ne merge/rebase/cherry-pick **jamais**.
Il échouera volontairement si une PR de l'intervalle n'est plus ouverte/Draft
après autorisation de merge : adapter alors la politique de la prochaine
version plutôt que déguiser une fusion en réussite.

0/5 fournisseur commercial opérationnel, 0 story acceptée, pas d'E2E Electron,
WebBridge browser writes OFF. OCDX définitivement exclu. Aucune modification
de `main`, d'OpenCode installé, de l'upstream ni d'Unifia.
