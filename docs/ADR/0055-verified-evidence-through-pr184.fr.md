# ADR 0055 — Preuves non productives vérifiées jusqu'à la PR #184

## Périmètre

Le registre G91 / #174 s'arrêtait à #173. Une vérification GitHub du
17 octobre 2026 a confirmé les SHA exacts et conclusions `success` des CI
pour #174 à #184 inclus, en particulier les quatre jobs de chaque workflow
représenté. Les travaux de #175 (release du host), #176 (préflight Desktop),
#177 (conditions contractuelles), #178 (paquet combiné), #179 (proxy natif),
#180 (Chromium DOM→RPC→SSE), #181 (outils), #182 (onglet incertain), #183
(lecture native `read.live`) et #184 (cinq adaptateurs synthétiques) restent
des **preuves partielles**, pas des stories acceptées en production.

## Décision

- Réconcilier les 43 PR contiguës #142–#184, avec SHA, nombre de jobs verts
  retenu et étiquette `*-partial`; rendre un SHA de #174–#184 non substituable
  silencieusement par une autre chaîne hexadécimale plausible.
- PR #182 : le SHA initial `e508e810...` a échoué sur le smoke Linux natif.
  Le SHA final retenu est uniquement
  `5929211bffb1c533eb7a789ca8cdb3ee20effb8d` avec CI `success`.
- Conserver `0` story acceptée dans les neuf épics, aucun fournisseur
  commercial opérationnel, aucune commande navigateur WebBridge activée.

## Validation

Le garde-fou `node scripts/check-progress.mjs` doit afficher 43 preuves
partielles, 9 épics / 54 stories / 66 issues, 0/5 et 0 acceptée.
Les trois tests de rejet (SHA récent falsifié, mauvais nombre de checks,
faux GO commercial/Desktop, preuves manquantes) doivent rester verts.

## NO-GO

Le validateur est **statique** : il n'interroge pas GitHub et ne fournit aucune
attestation d'origine ou d'intégrité autonome. Ses valeurs proviennent de la
vérification ponctuelle mentionnée ci-dessus. CLI OpenCode officiel ≠ Desktop
Electron installé. Pas d'autorité Core↔Desktop↔Chromium atomique ni provenance
du premier attachement, pas d'outil terminal/Git/fichier/sous-agent autorisé.
Pas de fournisseur commercial activé avant autorisation contractuelle.
OCDX est entièrement abandonné. Aucun merge/main/upstream/Unifia.
