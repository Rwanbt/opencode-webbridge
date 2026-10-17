# G37 — Traçabilité des frontières d'autorité et de streaming

Instantané du 17 octobre 2026, sans homologation de production. Les PR sont toutes Draft et non fusionnées.

| PR | SHA contrôlé | Preuve | Limite |
| --- | --- | --- | --- |
| #110 | `e8fc0ac1435a7192feac568c2486a0abf04f880d` | E2 BrowserLease: mutation des champs et réutilisation de ticket après révocation corrigées; CI native amont doublement verte | Référence Core non branchée sur Permission.Service/GUI |
| #111 | `20195d5c622c16b2b1eb251218aa03dad31a328c` | Schéma outils: rejet strict de tout résultat différent de `true`, y compris Promise; 100 tests locaux et double CI verte | Callback contractuel, pas encore une permission OpenCode réelle |
| #112 | `e2b02457ef46ed382d39c36935bfa006c5cdcaa8` | Retrait d'outil pendant attente d'autorisation détecté avant réservation durable; 101 tests locaux et double CI verte | Revérification non transactionnelle, course finale encore possible |
| #113 | `c2e86863e5a2d9ce2b28560ad7f1e5e6d0fe6dea` | Un événement terminal n'est rendu qu'après fermeture propre du flux; 103 tests locaux, CI Linux/Windows verte | Aucun fournisseur grand public réellement connecté |

L'éventuelle intégration `Permission.Service` et Desktop host one-shot en développement dans d'autres branches doit obtenir ses propres SHA, revues E2 et CI avant d'entrer dans ce registre. Un patch source appliqué au commit V2 officiel figé n'est **pas** une adoption en amont ni une fonctionnalité accessible dans OpenCode Desktop standard.

La matrice reste prudente : 9 épics, 54 stories, 66 issues, aucune story acceptée en production. Les journaux certifiés et témoins externes protègent les fixtures connues, mais ne fournissent pas encore une transaction distribuée exactement une fois avec un navigateur ou un site distant. Les cinq adaptateurs commerciaux restent désactivés.
