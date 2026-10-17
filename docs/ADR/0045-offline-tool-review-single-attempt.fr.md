# ADR 0045 — Revue native hors ligne : anti-rejeu et mutation de permission

## Contexte

G72 / PR #157 analyse une proposition d'outil web structurée, liée à un scope natif,
et appelle `Plugin.Context.permission.assert` deux fois. Elle ne dispose d'**aucun
exécuteur**. Une même `operationID` pouvait néanmoins provoquer plusieurs prompts,
y compris en parallèle. Le registre natif `tools` pouvait changer pendant un
`await` de consentement, mais l'ancienne définition était encore considérée vérifiée.

## Décision

- Réserver `operationID` **avant** le premier `await`, dans un `Set` propre à
  l'instance de revue. Les opérations concurrentes, déjà vérifiées ou refusées sont
  rejetées. Capacité de 1024 sans éviction : épuisement = refus et récupération
  opérateur, jamais réutilisation silencieuse d'une ancienne identité.
- Revalider à chaque frontière le scope et l'epoch, **ainsi que** l'identité de la
  définition native, son action, son schéma et ses ressources exactes. La mutation
  pendant le prompt invalide le résultat. Envoyer une copie indépendante des
  ressources lors de chaque `permission.assert`.
- Aucun contenu de page ne définit la politique native et aucune autorisation ne
  devient une exécution implicite. Le retour reste `status: checked-only`.

## Preuves RED → GREEN

- Avant correction, la deuxième revue concurrente de la même opération réussissait
  et une modification native de l'action, des ressources ou du registre au milieu
  d'un prompt renvoyait `checked-only` : deux tests runtime `Missing expected rejection`.
- Après correction, tests ciblés 9/9 (dont refus, saturation et anti-rejeu), build
  TypeScript et vérification du backlog 9 épics / 54 stories réussis.

## Limites / NO-GO

Ce mécanisme est **volatile et hors ligne**. Il n'est pas un journal durable,
une attestation du processus Desktop, une preuve de consommation de ticket Core,
un lien avec `read.commit/read.live`, ni une transaction avant effet réel.
Un redémarrage recrée un registre vierge : **interdit d'utiliser cette revue pour
autoriser un effet terminal/fichier/Git/sous-agent**. Les vraies opérations
nécessitent un broker natif avec confirmation opérateur, journal durable,
idempotence, révocation et réconciliation des résultats incertains.
WebBridge `navigate/click/fill/submit` restent OFF, aucun fournisseur commercial
opérationnel (0/5), aucune story acceptée production (0), aucun Electron E2E.
Ne pas utiliser OCDX. Aucun changement à l'installation officielle d'OpenCode.
