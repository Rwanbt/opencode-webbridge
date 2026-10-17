# ADR 0036 — Matrice de preuves partielle jusqu'à G86/G88/G90

Statut : gouvernance de revue **NO-GO production** — 17 octobre 2026.

## Éléments explicitement contrôlés

L'extension de `planning/progress.json` associe les Draft PR **#163 à #173**
à leurs SHA exacts constatés sur GitHub. CI réussie : #163–#167 (8 checks
chacune sur deux déclenchements), #168–#173 (4 jobs GitHub réussis chacun).
Ce sont des preuves **partielles** et non une acceptation fonctionnelle.

- #163 : package inerte installable/réversible.
- #164 : matrice E0–E8 ; aucune story acceptée.
- #165–#166 : révocation et claim incertain du broker hors ligne.
- #167 : plugin RPC fixture réellement chargé depuis tarball en CLI officiel.
- #168 : arrêt de l'émission SSE suite à une déconnexion.
- #169 : blocage natif de certaines destinations tunnel ; une régression de
  compatibilité officielle est auditée séparément, donc aucun GO.
- #170 : interruption HTTP propagée au poll BrowserPort en fixture.
- #171 : refus du témoin anti-rollback physiquement inclus via jonction.
- #172 : modèle CLI de fixture relié au package RPC installé et au SSE local.
- #173 : compatibilité de destinations tunnel privées à travers allowlist
  stricte du processus serveur, sans autorité client supplémentaire.

Le garde-fou maintient la continuité des PR revendiquées, l'exactitude des
comptes historiques documentés (6 / 8 / 4), leurs identifiants uniques et les
gates négatifs. Il ne récupère pas lui-même les conclusions GitHub : chaque
nouvelle entrée exige un contrôle externe au SHA exact.

Les PR #172 et #173 ont initialement échoué puis ont été réparées avec de
nouveaux SHA vérifiés. La #173 ne résout toujours pas l'identité du premier
processus Desktop ni le partage RPC sans principal authentifié.

## Blocages non levés

Même si OpenCode Desktop 2.0.32 est installé sur l'hôte Windows, aucune E2E
Electron officielle n'est validée ; la RAM disponible était insuffisante pour
une exécution sûre sans reproduire 0x800705AF. Aucune preuve d'attestation
du premier processus Desktop ou de révocation atomique jusqu'à Chromium.
**0/5** fournisseur commercial actif, **0/54** stories acceptées, navigation,
clic, remplissage et soumission natifs WebBridge toujours désactivés.
