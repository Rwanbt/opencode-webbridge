# ADR 0078 — Réception de flux chiffrée et idempotente (F03 partiel)

**Statut : expérimental, NO-GO production.** Branche G127 basée sur #202, sans fusion.

## Problème et choix

Le port `observeCheckpointedRead` (#198) appelle une fonction `acknowledge(event)` injectée ;
il ne possédait pas de récepteur persistant réel. Un ACK volatil, perdu après émission ou
répété après crash, ne doit pas créer une double livraison ou autoriser un nouvel effet navigateur.

`DurableReadAckSink` réalise un **récepteur local hors ligne** de fragments déjà lus, avec
accusés idempotents `(scope, turnID, seq, contenu)`. Il accepte exclusivement une progression
contiguë, distingue les répétitions identiques des conflits, limite les volumes, refuse une
réémission après marqueur terminal et retourne des copies immuables des réponses reçues.

La réponse est conservée en **AES-256-GCM** local (nonce aléatoire, AAD liée au scope),
avec HMAC SHA-256 et témoin signé dans un **répertoire distinct**. L'écriture utilise
fichier temporaire, fsync, rename et fsync du répertoire sur Unix. Une perte de l'ACK client
après commit peut être vérifiée de façon idempotente ; une discordance après crash entre
journal chiffré et témoin déclenche **NO-GO avec réconciliation opérateur**, jamais un
rejeu aveugle. `initialize` et `open` sont distincts ; `open` refuse l'absence d'historique.

Les tests exécutables couvrent encrypted-at-rest, réouverture, ACK répété, saut de séquence,
conflit de contenu, identités discordantes, rollback, témoin manquant, concurrence, getter
hostile et intégration `BrowserPort.events → observeCheckpointedRead → sink → checkpoint`.

## Frontières et limites importantes

- Le sink **ne prouve ni une autorité OpenCode native, ni la provenance Electron**, ni
  l'exécution de la page commerciale. `authorizeRead` est injecté uniquement dans la fixture.
- Le journal chiffré et son témoin ne résistent pas à l'effacement/réinitialisation hostile
  des deux supports avec possibilité pour un acteur non fiable d'appeler `initialize`.
  La clé est fournie par le caller et doit être gérée par un vrai SecretBroker.
- Le store persiste du **texte de réponse** chiffré et n'accepte aucun champ séparé
  de cookie, token ou prompt. Le texte lui-même peut néanmoins contenir des secrets
  reflétés par une page : il reste à relier à des politiques réelles de rétention, DLP
  et suppression, ainsi qu'au stockage de session officiel d'OpenCode.
- Un résultat d'ACK/persist considéré incertain n'autorise pas automatiquement le
  rejeu d'un effet ou le déblocage après rollback. Aucune atomicité Core↔host↔Chromium
  n'est attestée ; la persistance disque Windows n'est pas une preuve d'atomicité
  inter-processus ou de panne matérielle.
- Le paquet officiel distribué ne consomme pas encore ce sink. **Ce lot ferme une
  couture locale F03, pas le parcours end-to-end officiel F01/D01.**
- Aucun fournisseur commercial n'est activé, aucun compte n'a été utilisé,
  `navigate/click/fill/submit` WebBridge restent OFF ;
  `commercialProvidersOperational=[]`, `productionAcceptedStoryIDs=[]`.

## Suites bloquantes

Autorité native OS vérifiable, persistance de session officielle, tests réels CLI/GUI
packagés, gestion de clés et rétention/DLP, protocole de reprise en cas de divergence
journal/témoin, tests de pannes système réelles et qualification des dépendances avant
toute activation.
