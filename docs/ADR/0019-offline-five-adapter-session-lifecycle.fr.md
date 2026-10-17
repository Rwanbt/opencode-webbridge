# ADR 0019 — Contrat partagé hors ligne pour cinq adaptateurs et sessions manuelles

## But

Le catalogue contient ChatGPT, DeepSeek, Gemini, Qwen et Mistral Le Chat, mais **aucun de leurs sites web n'est ouvert ou piloté** par cette implémentation. `OfflineAdapterSession` est un banc de contrat en mémoire réservé aux fixtures, pas un navigateur, un fournisseur OpenCode enregistré ou un contournement de politique commerciale. `initialGates()` reste refusé pour les cinq fournisseurs; l'entrée de production `src/index.ts` est toujours inerte.

## Contrat exécutable

- L'identité est une liaison figée **providerID + sessionID + accountRef + tabID + connectionID + generation**. Aucun champ de cookies, token, mot de passe, URL, sélecteur DOM ou stockage navigateur n'est accepté. Un autre compte, workspace indirect, onglet, connexion ou génération ne peut agir sur un tour.
- La « connexion manuelle » est seulement un **signal fourni par un host de test fiable** (`signedIn: boolean`), jamais une lecture ou soumission de credentials. Ce signal permet uniquement la phase `fixture-ready` et ne confère aucun droit d'inférence commercial.
- Les fragments doivent porter le tour exact, une séquence strictement consécutive et une taille limitée (4096 caractères par fragment, 16 000 cumulés, au plus 63 fragments). Le résultat terminal doit correspondre exactement aux fragments acceptés. Le contenu reste **donnée non fiable**, pas une proposition automatiquement exécutable.
- Après interruption, la phase devient `uncertain`; ni `finish`, ni nouvelle connexion, ni replay ne peuvent réussir avant une réconciliation manuelle contenant l'identité exacte du tour, un résultat observé et un hash d'évidence. Même après preuve « non appliqué », l'ancien `turnID` reste une tombstone et tout nouvel essai doit avoir une identité distincte et une nouvelle observation manuelle. Reconnexion légitime impose nouvelle `connectionID` et génération strictement supérieure, avec account/session/tab identiques.
- Les tombstones et l'état sont volatils et plafonnés à 64 tours; le journal durable, l'anti-rollback et l'attestation opérateur ne sont **pas** assurés par cette fixture. Aucune autorité Core↔Desktop/Chromium n'est impliquée.

## Tests et critères restants

Quinze tests paramétrés, **trois par fournisseur**, vérifient identification manuelle, progression/finish, déconnexion/reconnexion, confusion compte/session/onglet/génération, champs de credential, fragments erronés, interruption et absence de rejeu aveugle. Ils sont intégrés aux tests Node de la CI; ce ne sont **pas** des tests des DOM commerciaux, des conditions contractuelles ni de sessions authentifiées réelles. Chaque site nécessite encore autorisation contractuelle datée et vérifiée, adaptateur technique conforme, preuve Core/browser officielle, login volontaire, tests E2E et revue indépendante.

**Statut de livraison : 0/5 fournisseurs commerciaux opérationnels, aucune acceptation production.** Les écritures WebBridge sont interdites, le patch OpenCode épinglé reste inchangé; aucune fusion.
