# ADR 0066 — Réservation durable avant revue native d'un outil hors ligne

## Défaut confirmé

G102 / PR #181 refuse le rejouage d'une proposition par `operationID` dans un
`Set` volatile. Un **nouvel objet après redémarrage** oublie cet historique et
peut redemander les permissions natives pour la même opération. Il ne doit
jamais être confondu avec une permission d'exécuter un outil.

## Changement

Le reviewer de permission accepte un hook natif optionnel
`reserveOperation(operationID, scope)`, exécuté **avant** le premier `await`
et donc avant toute demande `Plugin.Context.permission.assert`. Il doit
terminer de façon synchrone : toute promesse ou erreur refuse la revue.
L'ancien anti-rejeu volatil demeure actif, y compris lorsque la réservation
échoue. Un appelant qui n'utilise pas ce hook ne gagne aucune prétendue
durabilité.

Le test d'intégration branche ce hook sur le vrai `DurableRelayJournal.prepare`
de référence. Le journal HMAC et son témoin indépendant sont portés
strictement de la version renforcée G90 / PR #171 sur ce worktree isolé :
lock exclusif, fsync, témoin externe et contrôle des chemins réels. Le
redémarrage conserve la réservation `prepared`, refuse sa répétition ainsi
que tout nouvel effet ambigu jusqu'à intervention de l'opérateur.

## RED → GREEN

Avant le hook : deux tests runtime échouaient (aucune entrée journal au lieu de
`prepared` ; réservation échouée malgré laquelle les permissions étaient
appelées). Après : quatre tests d'intégration passent (redémarrage/rejeu,
échec de pré-réservation, callback asynchrone refusé et rollback d'un journal
HMAC pourtant valide détecté par le témoin) ; les neuf tests G102 sont
également verts. TypeScript et backlog 9 épics / 54 stories vérifiés.

## Limites et NO-GO

L'interface de revue reste **strictement `checked-only`**, sans exécuteur
terminal/fichier/Git/sous-agent, sans ticket de commit et sans effet externe.
Le témoin n'est indépendant que si l'opérateur le place et le protège sur
un stockage réellement distinct ; un rollback simultané de tous les supports
reste possible. Le journal de référence associe les identifiants de
session/fournisseur/onglet/compte, **pas** encore tous les identifiants
workspace/agent/turn/call/génération requis pour une vraie autorité native.
Le hook est optionnel et doit être câblé par un hôte de confiance avant tout
effet ; il ne permet **aucune activation** WebBridge à lui seul.

Écritures navigateur WebBridge désactivées, 0/5 fournisseur commercial
opérationnel, 0 story acceptée, pas de vrai Electron Desktop E2E et aucune
modification d'OpenCode installé. OCDX exclu définitivement. Aucun merge.
