# ADR 0074 — Reprise d'un flux en lecture seule par checkpoint durable

## Défaut confirmé

`planRecovery()` propose `fromFragmentIndex: 0` après zéro fragment confirmé,
alors que `admitFragment` refusait auparavant `seq: 0`. Une reprise
progressive ne pouvait donc pas accepter le premier fragment, même sans
réseau ni effet de navigateur. Test runtime RED sur la règle originale.

Un autre angle mort restait non couvert : `planRecovery` reçoit un `record`
fourni par l'appelant. Un nouveau processus sans **historique réellement
chargé** pouvait fournir `null` et obtenir `fresh-start`, même si une
ancienne opération avait existé. Ce résultat n'est pas une preuve d'absence
d'opération sur le disque.

## Implémentation

`DurableReadCheckpoint` enregistre uniquement les identités opaques sous
HMAC, le `turnID`, l'index confirmé et les états `streaming/finished/aborted`.
Chaque admission séquentielle est fsyncée avec renommage atomique avant
son ACK, puis inscrite dans un témoin HMAC **placé dans un dossier disjoint**.
Le `lock` exclusif interdit deux writers. Le témoin refuse un retour à une
ancienne version pourtant valide au MAC, une corruption, une clé erronée ou
la disparition d'un seul des supports.

`initialize()` crée un tour **explicitement neuf** ; `open()` n'est qu'une
reprise et refuse les deux fichiers manquants, au lieu de rebooter une histoire
vide. Le stockage ne contient ni prompt, texte de réponse, cookie ni token.
`plan()` fournit l'état lu au `session-recovery-coordinator` existant, qui
refuse changement de compte/session/onglet/génération/connexion, expiration et
tentative de reprise après un marqueur terminal. Premier index désormais 0.

## RED → GREEN et limites

Le build RED échouait sur l'absence du composant de checkpoint. La règle
préexistante refusait `seq=0` après `lastConfirmed=-1` ; elle est corrigée.
GREEN : tests ciblés de restart, checkpoint fsync, déduplication, ordre,
identity mismatch, lock, abort/finish durables, rollback signé, disparition
simultanée de deux fichiers, ancien timestamp et témoin imbriqué.

**NO-GO important :** le magasin ne contrôle pas un effet Chromium ; c'est
un curseur durable pour un flux **read-only déjà autorisé par ailleurs**.
Il n'est pas câblé au processus officiel CLI/renderer, à l'autorité Core
ni au journal des effets `submit/click/fill`. Le processus hôte doit
authentifier réellement les identités avant `initialize/open`, protéger sa
clé HMAC en dehors du dossier et garder le témoin sur un support indépendant.
Un attaquant capable d'effacer et de réinitialiser les deux supports via
`initialize` contournerait la continuité : création réservée à une autorité
native vérifiée. Sur Windows, fsync du répertoire n'est pas disponible.
Ces limites empêchent toute qualification de sécurité interprocessus ou
de reprise des écritures. `navigate/click/fill/submit` restent OFF.

Aucun E2E Electron officiel ; 0/5 commercial, 0 story acceptée. OCDX exclu.
Le développement ne modifie pas l'installation officielle d'OpenCode.
