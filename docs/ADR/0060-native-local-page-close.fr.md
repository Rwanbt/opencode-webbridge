# ADR 0043 — Fermeture réelle de la page Chromium (G113)

## Contexte

G100 vérifie la navigation d'onglet et G112 introduit le terminal `browser-disconnected` sur le RPC de test. Il reste à exercer ce dernier état après une **véritable fermeture de page Chromium** sur un tour OpenCode CLI progressif.

## Décision et expérience Linux CI

Réutiliser le même scénario G99/G100, la même page de chat locale, le même paquet installé RPC+modèle, et la même infrastructure de preuve, mais fermer réellement `browser.page` après la première progression DOM déjà observée dans un fragment SSE. Vérifier `isClosed()`, engager une seule fois `browser-disconnected`, rejeter les écritures et succès tardifs, puis annuler le tour CLI. La CI Linux lance ce scénario séparément, séquentiellement, sans Chromium sous Windows ni compte commercial.

## Limitations NO-GO

Le harness connaît la fermeture et déclenche explicitement le RPC `uncertain` ; **aucun détecteur automatique de perte de transport production** n'est prouvé. La réouverture de session, le redémarrage, les vrais fournisseurs, l'identité du processus Desktop et les effets Core–Chromium atomiques demeurent hors périmètre. Navigate/click/fill/submit WebBridge restent désactivés ; 0/5 fournisseurs opérationnels, 0 story acceptée. Aucune dépendance OCDX.
