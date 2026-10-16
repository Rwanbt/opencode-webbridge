# OpenCode WebBridge — feuille de route

**Objectif :** proposer dans OpenCode 2 une véritable sélection de fournisseurs web natifs, en exploitant des comptes utilisateur connectés manuellement sur ChatGPT, DeepSeek, Gemini, Qwen et Mistral Le Chat, sans clé d'API d'inférence.

**Statut actuel :** dépôt, socle TypeScript, tests de catalogue et documentation. Aucun modèle utilisable, aucune automatisation de navigateur.

**Priorité 1 :** prouver sur OpenCode 2.0.29 que le plugin natif peut piloter *le navigateur intégré existant* et brancher une exécution de modèle, plutôt que de seulement modifier le catalogue des modèles.

**Priorité 2 :** construire un banc de test local qui reproduit une interface de chat et valide capture, interruption, permissions, isolation des onglets, journal des effets et reprise après crash.

**Priorité 3 :** développer une couche fournisseur commune et les cinq adaptateurs, indépendamment activables, sous réserve de la compatibilité technique et des règles de chaque service.

**Priorité 4 :** livrer sélection de modèles, outils OpenCode, sessions, sous-agents, travail Git et installation reproductible. Aucun contournement de protections ou quotas n'entre dans le périmètre.

**Origine :** architecture inspirée de Chat On Steroids (MIT) ; fork sélectif de composants à étudier, et non reprise de l'application Electron complète.
