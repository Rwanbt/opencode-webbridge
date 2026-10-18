# ADR 0084 — Validation stricte des propositions d'outils non fiables (G133)

**Statut : incrément indépendant de sécurité T01/T02 ; production NO-GO.**
Base G130 #209, sans changement de ses chemins CLI/Chromium.

## Vulnérabilités RED prouvées

L'interface de validation d'une proposition `file.read` / `git.*` acceptait des
champs inconnus et des métadonnées d'autorité fabriquées. Elle accédait directement
aux propriétés de sortie d'un modèle ou d'une page web et appelait
`JSON.stringify(args)` **avant** de supprimer les méthodes/getters non fiables.
Un getter ou `toJSON` fourni par le caller pouvait donc exécuter du JavaScript
dans le processus du validateur. L'objet validé n'était pas entièrement figé.

Trois tests ont réellement échoué sur le code initial (getters et toJSON,
champs cachés, figement incomplet), puis sont devenus verts avec le correctif.

## Correctif

- Vérifie la forme **exacte** des objets top-level, provenance et arguments,
  sans accepter champs additionnels, symboles, méthodes non énumérables,
  propriétés héritées ou accessors ; les seules clés optionnelles sont celles
  explicitement autorisées pour l'action.
- Matérialise des copies de champs de données propres avant lecture,
  `JSON.stringify` et normalisation des chemins de workspace.
- Compare la provenance copiée avec le scope fourni séparément, refuse
  l'usurpation ; renvoie des objets proposition/provenance/arguments détachés
  et gelés, empêchant de les modifier après validation.
- Maintient les actions strictement **read-only** (`file.read`, `git.status`,
  `git.diff`, `git.log`). Aucun `terminal.exec`, `git.push`, `file.write`
  ou permission d'exécution implicite n'est ajouté.

## Frontières non résolues

Les introspections `Object.getPrototypeOf`, `Reflect.ownKeys` et
`Object.getOwnPropertyDescriptor` peuvent encore déclencher des traps si un
`Proxy` JavaScript arbitraire est déjà exécuté dans **la même mémoire**.
Il faut parser un format sérialisé avec limites d'octets dans un processus
ou une isolation de confiance **avant** l'appel à cette API.

Les propositions validées ne sont **pas exécutées** par cet incrément :
ni consentement utilisateur effectif, ni permission Core authentifiée,
ni isolation des chemins via handle OS, ni effet terminal/fichier/Git réel.
Revalidation au moment de l'effet, journal durable et reçu post-exécution
restent des exigences indépendantes. Aucun résultat n'est accepté production.
Fournisseurs commerciaux 0/5 et écritures WebBridge OFF.
