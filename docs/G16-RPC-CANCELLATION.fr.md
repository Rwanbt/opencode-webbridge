# G16 — Annulation RPC avant remise au navigateur (fixture uniquement)

Le contrat RPC de test expose désormais `cancel` avec le même secret de 256 bits et la même identité `{ sessionID, providerID, tabID, accountRef }` que `submit`, `take`, `progress` et `observe`.

Une annulation n'est confirmée (`cancelled: true`) **que si le tour est encore en attente, sans effet attribué au compagnon** : le journal passe de `prepared` à `cancelled`, `take` ne remettra pas la demande, et le client reçoit l'événement terminal `cancelled`. Après attribution (`leased`), la réponse est `cancelled: false` : l'effet est incertain et peut déjà avoir eu lieu. Aucun arrêt distant n'est inventé, aucune nouvelle soumission automatique n'est permise.

Le `RpcBrowserFixturePort` vérifie les accusés de réception et refuse leurs versions malformées. La suite couvre les deux phases, une identité erronée, un secret erroné et le branchement réel du gestionnaire RPC de test. `npm test` et la CI utilisent uniquement des identités et pages locales synthétiques.

**Non couvert :** l'arrêt réel d'une génération déjà commencée sur un service web, l'arrêt de processus ou de navigation Desktop, la reprise distante après crash et les cinq comptes commerciaux. L'API navigateur et une politique fournisseur autorisée sont nécessaires avant toute activation réelle.
