# ADR 0090 — Identité d'autorité figée à travers les attentes asynchrones (G139)

**Statut : correction fail-closed du contrat T02/S01, NO-GO production.**
Nouvelle branche isolée sur G136 #213 ; sans modification de l'OpenCode installé.

## Défauts RED effectivement reproduits

- `buildAuthorityContext` invoquait les getters de valeurs appelées à plusieurs
  reprises ; le résultat `AuthorityContext` restait mutable.
- `sameAuthority` omettait `deadline`, permettant une comparaison égale entre
  tickets d'échéances différentes. `isExpired` sur `NaN` ou `Infinity` pouvait
  retourner faux, donc accepter une horloge non fiable.
- Une session, génération, politique ou échéance mutable fournie à
  `runAuthorizedEffect` pouvait être modifiée pendant les `await` native
  attestation / exécution : le code pouvait annoncer un succès malgré un
  contexte désormais différent. Tests RED sur les deux étapes.

## Protocole GREEN

`buildAuthorityContext` ne lit que les **propres descripteurs de données**
de la liste obligatoire exacte, rejette getters, champs supplémentaires,
valeurs manquantes et mauvais types, copie puis fige l'intégralité des champs.
`sameAuthority` inclut l'échéance. Une horloge ou échéance non entière,
non finie ou négative fait considérer le ticket expiré.

`runAuthorizedEffect` valide et fige un **snapshot d'identité au départ**,
utilise uniquement ce snapshot pour l'attestation. Il revérifie la forme et
l'égalité de l'identité originale après l'autorisation asynchrone, avant
`consume` : mutation = refus sans effet. Après tentative d'effet,
toute mutation détectée aboutit à `uncertain` irréversible, jamais succès.

Les tests RED→GREEN sont exécutables, avec mutation réelle pendant `await`.
Le verrou unique G136 reste en place et les tests de transition restent verts.

## Limites impératives

Ces introspections seraient elles-mêmes susceptibles de déclencher les
traps d'un véritable `Proxy` JavaScript déjà exécuté dans le processus.
L'entrée du host doit être un message sérialisé et parsé dans une frontière
de confiance ; ce module ne prouve pas le principal OS ni une attestation
Electron. Le contrat `NativeEffectAuthority` est simulé seulement dans les
tests ; distribué `authority: null`, **aucun effet exécuté**.

Le protocole n'est pas un registre d'effets durable inter-processus ;
aucune écriture navigateur, aucun outil natif activé, 0/5 fournisseur,
0/54 story production, WebBridge writes OFF.
