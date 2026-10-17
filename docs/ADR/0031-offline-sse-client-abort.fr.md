# ADR 0031 — Client SSE déconnecté : arrêter la diffusion de fixture

## Problème

Le flux SSE local du modèle pouvait continuer à consommer et à émettre des fragments après fermeture de la connexion HTTP par son client. Le champ `streamFrames` compte alors une activité sans récepteur. Cette situation ne signifie ni réussite du tour ni permission de renvoyer le prompt.

## Incrément

Un `AbortSignal` local est désormais fourni au responder de fixture et déclenché uniquement lorsque la **réponse HTTP** se ferme prématurément (`res.close` sans `writableEnded`), pas lors de la fin normale du corps de requête. Le producteur vérifie l'abandon avant chaque nouvelle publication SSE et avant le marqueur final. Un test réseau Node réel reçoit une première trame, coupe le client pendant l'attente de la seconde, observe le signal d'abandon, puis libère la seconde : aucune seconde trame ni `[DONE]` ne sont publiés. Le signal permet au compagnon hors ligne d'arrêter ses travaux facultatifs, sans prétendre annuler rétroactivement un effet déjà envoyé.

## Frontières

Cette évolution touche exclusivement le fournisseur **de test loopback**, et ne prouve pas la propagation d'un signal d'annulation jusqu'à l'Electron Desktop officiel, ni l'atomicité des permissions Core/Chromium. L'itérateur peut rester suspendu jusqu'à une résolution de son attente propre; aucune fermeture de compte ou clic distant n'est supposé. Les écritures WebBridge demeurent interdites. 0/5 fournisseurs commerciaux opérationnels, zéro acceptation production, pas de fusion.
