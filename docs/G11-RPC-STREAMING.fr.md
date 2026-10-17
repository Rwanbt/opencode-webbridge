# G11 — Progression RPC ordonnée, sans libération prématurée du tour

Le relais WebBridge G3–G10 délivrait sa réponse seulement à la fin. Le nouveau contrat conserve un compteur `seq` strictement croissant, transmet des morceaux de texte via le RPC **test-only** `progress` et permet à OpenCode de les lire par `observe(turnID, afterSeq)`. `complete` marque la fin uniquement si la réponse finale correspond exactement à la concaténation des fragments déjà émis. Aucun morceau n'est ré-envoyé par la méthode de lecture lorsque le client avance son curseur.

**Correction de sécurité :** une tâche ayant déjà produit un fragment mais pas encore reçu de fin reste `busy`. Avant cette modification, la simple présence d'événements pouvait libérer le verrou logique et permettre de soumettre un deuxième tour trop tôt. Le journal durable conserve la phase `leased` jusqu'à la confirmation finale. Les fragments sont bornés (16 000 caractères au total, 62 fragments), avec contrôle du propriétaire et du secret sur chaque appel.

Le `BrowserPort` de test consomme maintenant les événements ordonnés du RPC plutôt que de reconstituer toute la réponse à partir du seul résultat final. Les smokes de modèle OpenCode 2.0.29 + RPC + Chromium local doivent couvrir `submit → take → progress → complete → observe`, sans accès aux cinq services commerciaux.

**Limites :** cela valide l'infrastructure de streaming et ses invariants, pas le streaming DOM d'un véritable site. Aucun outil ni compte web n'est activé. L'interruption d'un travail déjà remis au navigateur reste **incertaine**, jamais faussement signalée comme arrêtée. Il faut encore instrumenter et valider la progression réelle auprès d'une API navigateur autorisée et relier les événements au rendu natif de session.
