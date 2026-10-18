# ADR 0077 — Réconcilier les preuves partielles des branches divergentes jusqu'à #201

## Contexte

La branche fonctionnelle G120/#196, prolongée par G121–G123/#197–#201,
ne contenait que les 13 entrées `planning/progress.json` #142–#154.
Le registre G116/#192 maintenu séparément avait déjà qualifié #142–#190
en 49 preuves non productives. Ces branches n'ont pas été fusionnées et le
simple fait qu'une CI soit verte ne garantit pas leur intégration réelle.

## Décision

Porter **sans merge** les trois fichiers de garde-fous vérifiés G116/#192
depuis son SHA `fc6fcbc541310273102e655c605191576ad5e406` sur une nouvelle
branche isolée basée sur G123/#201. Verrouiller ensuite les 11 HEAD finaux
#191–#201 avec leurs SHA exacts et au moins une exécution CI GitHub `success`
à ce SHA, en comptant uniquement les jobs de l'exécution retenue (4 chacun,
sauf #200 qui comporte 5 jobs dont le vrai CLI 2.0.32).

La matrice comporte maintenant **60 preuves partielles contiguës** #142–#201,
réparties sur E0–E8. Aucun statut de story, de fournisseur ou de sécurité
production n'est augmenté. Les branches #199 sécurité native et #200
contrat GUI restent **divergentes** de #201 ; leur présence dans le registre
ne signifie pas que leurs modifications sont dans le même binaire.

## Vérifications et NO-GO

`check:progress` vérifie le verrou SHA récent, la séquence, les comptes CI,
les neuf épics, 54 stories et 66 issues, et refuse les prétentions commerciales,
Desktop ou browser write. Trois tests négatifs gardent les SHA truqués,
missing entries et faux GO hors du registre. `check:acceptance` reste 0/54,
`check:release` reste `NO-GO-PRODUCTION` et 0/5 commercial.

Le validateur est **statique** et ne contacte pas GitHub pendant la CI :
chaque valeur a été rapprochée des conclusions exact-SHA accessibles lors
de la préparation. Ce n'est pas une preuve d'attestation Electron, un merge
des PR, une autorisation contractuelle, ni un journal des effets Chromium.
Le manque d'API de provenance du premier processus et l'atomicité Core→driver
restent bloquants. OCDX exclu ; aucune modification d'OpenCode installé.
