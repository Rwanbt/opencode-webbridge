# ADR 0015 — Flux DOM réellement observé, interruptions et lecture RPC à curseur

## Bug dynamique RED et correction

Avec des fragments DOM réellement espacés, un `RpcRelayPort.events(afterSeq)` de G64 attendait **uniquement le premier événement du tour**. Après réception du fragment N, `events(afterSeq=N)` renvoyait immédiatement `[]` autant de fois que le lecteur l'appelait. `exchangeBrowserTurn` épuisait alors son budget de lectures avant le fragment N+1 et produisait `browser turn uncertain: no terminal event`; un smoke complet OpenCode↔RPC↔page locale a échoué par timeout de l'exécuteur. Ce défaut n'est pas une panne de dépendances.

G65 ne rend `events` immédiatement que lorsqu'un événement **strictement postérieur au curseur** existe, ou que le tour est terminal; sinon il attend de manière bornée la prochaine notification. Le test adversarial crée un tour loué, publie le fragment 1, demande `events(..., 1)`, vérifie que la lecture reste en attente et ne reçoit que le fragment 2 lorsqu'il survient. Aucun renvoi automatique de `submit` n'est ajouté. Le banc de test OpenCode utilise jusqu'à 16 sondages bornés pour des flux multi-fragments et signale immédiatement une erreur du compagnon, sans masquer un délai global sous une réussite.

## Véritable page locale de fixture

Le HTML écoutant sur `127.0.0.1` publie trois fragments dans des éléments DOM persistants `data-seq=1..3`, avec un identifiant aléatoire propre au tour et un état `streaming` / `finished` / `stopped`. Le lecteur Playwright observe chaque élément DOM et l'envoie au relais **avant** de voir `finished`. Le test autonome `smoke:dom-rpc` démontre : fragments 1–3 réellement observés et accusés par le relais, réponse terminale identique, absence de finalité après arrêt, impossibilité de redélivrer à l'aveugle un tour loué interrompu. Le smoke `smoke:local-read` vérifie également que recharger/changer le document pendant le flux entraîne un statut *incertain* et jamais un succès ou une répétition silencieuse.

Les contrôles restent bornés à l'unique page locale et un profil Chromium de test isolé. La CSP interdit les connexions externes, et le lecteur refuse toute autre URL, identifiant, cookie ou site commercial. Aucun fournisseur n'est authentifié ni automatisé.

## Blocages non résolus

La fixture OpenCode peut attendre la fin de la collecte des fragments avant de publier les tokens du modèle : observer des progressions DOM/RPC ne prouve donc **pas** une sortie progressive réelle dans l'UI modèle. Chromium/Playwright n'est pas l'Electron Desktop officiel. Aucun commit atomique Core↔Desktop↔Chromium, aucune attestation du caller `attach`, aucun broker d'effets d'écriture ne sont certifiés. Un arrêt après envoi laisse le tour **incertain** et non rejouable sans réconciliation; le journal ne contient pas le texte. `navigate`, `click`, `fill`, `submit` WebBridge restent désactivés. 0/5 fournisseurs commerciaux opérationnels; 0 acceptation production; aucune fusion.
