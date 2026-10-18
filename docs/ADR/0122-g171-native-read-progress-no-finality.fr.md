# ADR 0122 — G171, observation progressive sans finalité fabriquée

Le véritable outil `webbridge_browser` du plugin racine offre désormais l'action `observe` pour un onglet et une réponse assistant explicitement choisis. La lecture est bornée (1 à 12 sondages), revalide la permission après chaque fragment, conserve l'identité du document issue de G157/G160 et renvoie des fragments séquencés. Elle ne déclenche aucune écriture ni nouvelle inférence.

La réponse de l'outil est groupée en fin de sondage : ce **n'est pas** un flux SSE natif de modèle OpenCode. Aucun arrêt du DOM ne constitue un ACK de complétion fournisseur : `completionVerified:false`. La lecture ne prouve ni correspondance au prompt envoyé, ni session authentifiée, ni identité OS/Desktop. Qwen reste fermé tant que les sélecteurs ne sont pas vérifiés. Aucun indicateur d'acceptation production n'évolue.
