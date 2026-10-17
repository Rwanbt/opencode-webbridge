# ADR 0020 — G72 : propositions d’outils, contrôle natif hors ligne, NO-GO

**Décision : expérimentation désactivée, aucun outil exécutable, aucun fournisseur autorisé.**

G8 / PR #75 définit un `tool_proposal` v1, un journal durable et une interface
d'exécution injectée. La branche G69 n'inclut pas ces fichiers. G72 reprend
uniquement le format *structuré* sous une version **v2** exigeant désormais
`workspaceID`. Le v1 dépourvu de cette identité est refusé sans conversion
automatique. Aucun texte de page, Markdown ou JSON libre ne devient une
commande. Les noms et arguments proviennent d'une proposition **non fiable** ;
seul l'hôte OpenCode établit la session, le workspace, l'agent, le worktree,
le tour, l'onglet, le fournisseur, le compte et le registre des outils.

`OfflineToolPermissionReview.review` impose le schéma exact et des objets JSON
bornés sans accesseurs, puis résout dans une table **native de confiance** le
validateur des arguments, l'action et les ressources spécifiques. Il appelle
le contrat `Plugin.Context.permission.assert` d'OpenCode pour la session exacte,
le revérifie après chaque attente asynchrone, et exige une époque d'autorité
et une identité natives inchangées. Les ressources vides ou génériques `*`
sont rejetées. Un succès retourne uniquement `checked-only`, sans jeton
d'autorisation ni outil exécutable. La vérification n'est jamais une autorisation
transférable : les effets réels exigeraient une nouvelle autorisation atomique
possédée par Core et son effect broker.

**Preuves locales limitées :** tests adversariaux de pollution JSON et getters,
usurpation session/workspace/agent/worktree/tour, révocation du contexte
browser et des permissions pendant l'attente, déni natif, ressource non précise.
Le type `permission.assert` est celui du SDK 2.0.29, mais la permission des tests
est une implémentation simulée ; la production `src/index.ts` reste inerte.

**NO-GO :** le SDK externe ne fournit pas la transaction Core complète
(identité source certifiée, epoch native observable, permission exacte par
argument, lease lié à l'effet Desktop). Aucun agent, terminal, Git, outil,
cookie, compte web ou fournisseur commercial n'est sollicité. Aucun E2E
Electron/Desktop, aucune intégration native d'effet ni garantie TOCTOU
interprocessus n'est attestée. **0/5 commercial, 0 production.**
