# ADR 0035 — Empêcher la fausse indépendance du témoin anti-rollback

Statut : défense locale partielle, **NO-GO production**, 17 octobre 2026.

## RED

`DurableRelayJournal.open` vérifiait l'indépendance des chemins avec `resolve`
et des comparaisons lexicales. Un lien symbolique **dans le répertoire parent**
du témoin (jonction Windows) pointant sur le journal contourne cette vérification.
La fixture adversariale créait effectivement `journal/witness` en prétendant
ouvrir un emplacement externe et échouait par `Missing expected exception`.

## GREEN

Après création et validation de la destination, comparer `realpathSync.native`
des deux dossiers (casse normalisée sur Windows) et refuser inclusion ou égalité
physique. Ne pas créer de journal signé lorsqu'un témoin ainsi aliasé est fourni.

Tests ciblés : test adversarial RED→GREEN sur la machine Windows avec jonction,
plus suite journal/reprise/host **13/13 verts**, compilation TypeScript, backlog
9 épics/54 stories et diff vérifiés. CI exacte à vérifier après publication.

## Frontières

Cette correction empêche la **configuration initiale** d'un témoin physiquement
interne. Elle ne protège pas contre un attaquant pouvant remplacer un parent
du chemin *après* la vérification, possédant le secret de signature, ou restaurer
simultanément deux stockages indépendants. Les opérations restent fondées sur
des chemins et non des handles OS persistants (`dirfd`/no-follow). La politique
de séparation et la sécurité de l'hôte restent à certifier.

Ce journal est un composant de référence hors ligne, pas une attestation native
Core ↔ Desktop ↔ Chromium ; aucune écriture navigateur ni aucun fournisseur
commercial n'est autorisé. **NO-GO production.**
