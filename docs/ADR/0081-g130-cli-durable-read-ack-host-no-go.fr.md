# ADR 0081 — G130, accusés de lecture durables sur le parcours CLI 2.0.32

**Statut : qualification du récepteur de fixture, NO-GO Core natif et production.** Base G129 PR #207 exacte `200ae6808a9c4185712b8594d1915fd2b4442d50`, qui intègre G125 et le sink G127 mais pas leur exercice simultané. Aucun upstream, Desktop ou binaire officiel n'est modifié.

## Parcours exécutable

Le job Linux G130 installe `@opencode/cli@2.0.32` officiel, **un unique plugin `.tgz` G97**, un serveur RPC natif, un modèle synthétique sélectionné par le CLI et une vraie page Chromium sur `127.0.0.1`. La page produit les vrais fragments DOM, le plugin installé les expose par RPC `progress/poll`, puis le **récepteur dans le processus de test** utilise `DurableReadAckSink.acknowledge` et son `fsync` chiffré **avant** tout transfert vers le SSE synthétique et le CLI. Le sink est lié à l'ID de session obtenu via `GET /api/session` avant le premier ACK, ainsi qu'à un turnID et à une identité de fixture explicitement non privilégiée.

Pour chacun des deux scénarios (`tab-change` et `browser-disconnect`), deux tours normaux (upgrade/rollback) produisent 3 textes plus `finished`; le troisième crée 1 texte puis `cancelled` après vraie navigation d'onglet ou fermeture Chromium. Chaque première confirmation est volontairement « perdue » **après l'écriture**, puis le sink est rouvert et le même fragment retransmis **au seul sink**, sans relire ni redéclencher le navigateur ou le CLI. Le fichier chiffré ne doit pas changer lors de ce doublon. Les conflits de contenu, la progression post-terminal, la mauvaise session et la génération d'onglet erronée doivent être refusés.

La fixture G125 arrête réellement le serveur OpenCode natif puis en lance un autre sur le même profil et relit `/api/session/{id}` et `/message`. Après ce redémarrage du serveur, G130 rouvre **séparément** le fichier AES-GCM du host sink et son témoin indépendant, recoupe les types et séquences des ACK avec le résultat normal/interrompu de l'historique de session, et vérifie qu'aucun fragment DOM n'est enregistré en clair. La CI garde les tests de régression 2.0.29 distincts.

## Garanties exclues

`DurableReadAckSink` est ici **une preuve de persistance dans le host de test Node**, distinct du serveur CLI/OpenCode ; le redémarrage du CLI ne redémarre **pas** le host de test. Cette preuve ne constitue **pas** l'intégration dans le même processus du Core modifié, ni une identité OS attestée, une autorisation native de lecture, un `read.commit` natif ou une livraison avec ACK par le navigateur réel d'un fournisseur. La valeur `providerID=qwen` n'est qu'un emplacement de portée du contrat G127, pas une utilisation du service Qwen.

La correspondance `native session ↔ host receipt` est constatée dans un profil local de test et ne confère aucun droit. Les fournisseurs commerciaux restent **0/5**, les écritures navigateur **OFF**, le Desktop empaqueté **non testé**, la décision **NO-GO production** inchangée. Un vrai raccordement exige le transport Desktop/IPC de confiance, le broker de permissions et des attestations anti-rejeu sur la frontière des effets.
