# ADR 0014 — Fragments RPC progressifs, reprise par curseur et résultat incertain

## Périmètre vérifiable

Ce lot concerne uniquement le **modèle de test OpenCode** et son relais `webbridge-browser-fixture`. Il ne fournit ni extraction d'un service commercial, ni identité d'un processus Electron, ni autorité d'effet Chromium. L'entrée de production `src/index.ts` reste inerte. Les cinq fournisseurs sont toujours indisponibles en production.

## Contrat

Après `submit` et `take` (une unique livraison), le compagnon hors ligne peut appeler `progress(turnID, seq, value)` avec un fragment non vide et au plus 4096 caractères. Chaque `seq` doit être consécutif; le cumul est limité à 16 000 caractères et 64 événements, marqueur terminal inclus. La lecture `poll(turnID, afterSeq)` renvoie les seuls événements plus récents, avec l'identité du tour et les séquences conservées; l'adaptateur RPC détache et valide les événements avant de les fournir au modèle.

Le compagnon appelle `complete(turnID, fullResponse)` **une seule fois**. Cette réponse doit commencer par l'intégralité des fragments déjà acceptés : elle ne peut ni réécrire ni retirer un fragment. Le reste est publié en dernier événement texte, puis `finished`. Un `result` historique ne déclare plus `finished` tant que le marqueur terminal n'existe pas. Les requêtes pour un autre tour sont refusées tant qu'un tour n'est pas terminal, même après diffusion d'un fragment. En cas de déconnexion, timeout ou accusé de réception incertain, aucun fragment ni effet n'est rejoué automatiquement; il faut inspecter `poll`/le journal avant toute décision manuelle.

Le journal durable ne contient que les phases `prepared`/`leased`/`settled`/`cancelled`, jamais les textes partiels, cookies ou identifiants. Un crash après `progress` et avant `complete` demeure **incertain** et requiert réconciliation explicite. Ce n'est pas un protocole de commit distribué atomique ni de persistance intégrale des sorties.

## Preuves / limitations

Les tests négatifs vérifient les séquences sautées, répétées, la taille, les revendications d'un autre compte, les capacités secrètes incorrectes, la réponse finale qui réécrit un fragment, la concurrence et les événements terminaux. Le smoke `smoke:e2e` utilise le modèle OpenCode officiel mais un **compagnon simulé**, avec fragments via RPC, jamais OpenCode Electron. Le smoke `smoke:page`, lorsqu'il est disponible, ajoute une véritable page locale Chromium hors ligne : ce n'est toujours pas le navigateur Desktop officiel.

Même lorsque ces smokes passent, l'intégration de ces fragments au **flux de tokens côté modèle/GUI** n'est pas encore démontrée; la fixture OpenAI-compatible peut renvoyer le texte final d'un bloc. Pas d'automatisation ChatGPT/DeepSeek/Gemini/Qwen/Mistral sans autorisation contractuelle préalable. `navigate`, `click`, `fill`, `submit` WebBridge restent désactivés. Statut : 0/5 commerciaux, 0 acceptation production, aucune fusion.
