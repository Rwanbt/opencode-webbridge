# ADR 0061 — Preuves vérifiées #185–#190 sans acceptation production (G116)

## Décision

L'état machine du backlog suit désormais les 49 PR partielles contiguës #142–#190, dont les six nouvelles têtes #185–#190. Chaque SHA et les huit contrôles GitHub réussis ont été vérifiés avant inscription ; le garde-fou verrouille les SHA et dénonce toute substitution, disparition de PR, changement de nombre de contrôles ou acceptation commerciale/production sans preuve.

Les PR #189 et #190 constituent respectivement une transition RPC en mémoire après déconnexion et une vraie fermeture de page Chromium au sein du banc **CLI officiel + modèle local de test**. Elles ne sont pas des preuves de GUI Electron, de transport commercial, ni de reprise durable après crash. Le correctif natif #187 protège les métadonnées de `browser.tabs.list` lors des changements d'epoch, sans attester le premier processus Desktop attaché. #188 est un contrôle de provenance qui conclut explicitement NO-ELECTRON-E2E.

## Limites

Le registre d'évidence est une transcription statique verrouillée, non un interrogateur CI autonome. Les huit jobs proviennent de deux événements de workflow : quatre types de vérification. Tous les épics E0–E8 conservent **zéro story acceptée**, tous les fournisseurs **0/5 opérationnels**, aucun effet navigateur WebBridge en écriture, et aucune admission production. Les restrictions contractuelles, identité Desktop authentifiée, atomicité Chromium et récupération des états incertains sont non résolues. Aucune dépendance OCDX.
