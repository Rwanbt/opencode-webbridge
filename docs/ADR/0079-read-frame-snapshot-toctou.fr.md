# ADR 0079 — Figement des frames BrowserPort avant ACK (G128)

**Statut : correctif read-only partiel, NO-GO produit.** Branche fille de G127/#203.

## Défaut RED réel

Trois tests exécutables sur le chemin `observeCheckpointedRead` antérieur échouaient :

1. Une frame `text` validée pouvait être modifiée pendant l'attente
   `authorizeRead()` avant le `acknowledge()` : le texte **différent de celui validé**
   était transmis au récepteur et au caller.
2. Un objet `TabClaim` fourni puis muté pendant une autorisation asynchrone
   modifiait le `tabID` reçu par `BrowserPort.events` après vérification du scope.
3. Un getter non fiable de `value` était exécuté à plusieurs reprises par la
   validation, créant des effets JS non maîtrisés hors contrat.

## Correctif GREEN

`snapshotClaim` copie et fige exclusivement quatre propriétés de données
propres, vérifie leurs IDs opaques et n'utilise plus la référence caller lors
de l'appel après `await`. `snapshotBatch` matérialise la collection indexée
en contrôlant les descripteurs ; chaque frame est copiée et figée avant
validation de l'ordre, de la taille et de l'identité de la totalité du lot.
L'ACK et le `yield` reçoivent exclusivement ces snapshots immuables.

Les trois RED précédents passent ; les tests G122/G127 existants restent verts.
La modification ne soumet, ne clique, ne navigue et ne libère aucun effet navigateur.

## Limites non négociables

Ce snapshot ne constitue **pas une frontière anti-Proxy** : les traps
`Object.getPrototypeOf`/`Reflect.ownKeys`/`getOwnPropertyDescriptor` peuvent exécuter
du JS si un véritable Proxy non fiable est passé dans le même processus.
Le host de production devra parser des messages sérialisés vérifiés, dans sa
frontière de confiance, avant ce module.

L'autorité `authorizeRead` reste injectée, non reliée à l'OS ni au Core natif ;
les permissions persistées et la révocation inter-processus ne sont pas
certifiées de manière atomique. Aucune E2E Desktop packagée, aucune session
commerciale, aucun effet navigateur autorisé par ce correctif.

Gates : `commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`, writes `navigate/click/fill/submit` OFF.
