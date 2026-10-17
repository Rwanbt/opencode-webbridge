# G14 — Analyse indépendante des enfants natifs (17 octobre 2026)

Portée : profils temporaires, OpenCode CLI 2.0.29 et *fixtures locales uniquement*. Aucune navigation vers un service utilisateur.

## Constat établi

- PR [#83](https://github.com/Rwanbt/opencode-webbridge/pull/83), SHA `f57a927` : deux jobs Windows [38992295347](https://github.com/Rwanbt/opencode-webbridge/actions/runs/38992295347) et [38992317724](https://github.com/Rwanbt/opencode-webbridge/actions/runs/38992317724) affichent `G3 native OpenCode RPC relay: PASS`, puis échouent sur `ReferenceError: spawnSync is not defined`. La branche #83 avait supprimé l'import de `spawnSync` du script RPC mais conservé son usage lors du `finally` Windows.
- Anciens runs [38991545196](https://github.com/Rwanbt/opencode-webbridge/actions/runs/38991545196) et [38991521957](https://github.com/Rwanbt/opencode-webbridge/actions/runs/38991521957) : `smoke:page` échoue après 45 secondes **sur Windows et Linux**. L'ancienne trace n'enregistre pas le progrès du modèle : aucune attribution certaine de ce délai à Windows ou au nettoyage.
- Reproduction locale dans un worktree isolé : `smoke:native` et `smoke:browser` récupèrent la réponse attendue via le serveur fixture, mais leur processus CLI ne se ferme pas de lui-même avant les 60 secondes ; le script affiche `exit=null` et reste en échec. Des traces de watchers et de snapshots Git sont présentes ; leur lien causal précis avec l'absence de fermeture reste à prouver.

## Correctif borné

`trackNativeChild` surveille `close` dès `spawn`, termine le processus encore actif, applique un fallback direct sur Windows si `taskkill` échoue, puis **attend sa fermeture avant de supprimer les profils**. Un enfant encore ouvert après délai reste une **erreur**, jamais un succès implicite. Les scripts RPC et E2E n'annoncent `PASS` qu'une fois le nettoyage terminé. Les erreurs `smoke:page` exposent seulement des compteurs/indicateurs (présence du marqueur, tours, HTTP, DOM, état de sortie), sans contenu ni secrets. `smoke:native` réessaie de manière bornée la suppression de ses répertoires.

Le résultat terminal d'inférence et la fermeture naturelle du CLI sont deux observations distinctes. Ce correctif ne modifie aucune politique fournisseur et **ne certifie pas** la fermeture normale du CLI, l'accès navigateur de production ou les comptes web. Il reste à investiguer séparément le cas d'une réponse complète avec processus CLI persistant.
