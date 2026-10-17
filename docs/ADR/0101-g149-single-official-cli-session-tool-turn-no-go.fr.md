# ADR 0101 — G149 : un tour CLI 2.0.32, navigateur, RPC, outil et ACK durable

**Statut : intégration positive expérimentale Linux uniquement ; production NO-GO.**

## Défaillance RED / différence avec G146

G125/G130 qualifiaient le modèle CLI officiel, le DOM Chromium local, le RPC
natif, les deltas SSE, la session persistée et les reçus chiffrés du host.
G145/G146 qualifiaient **séparément** les lectures réellement exécutées sur
des fichiers/Git temporaires, le consentement fictif et la consommation
durable. Aucun seul tour **effectivement exécuté** par le CLI ne déclenchait
la chaîne d'outil, puis ne validait son journal avant une trame SSE.

## Implémentation / preuve attendue

La nouvelle factory `createG149VerticalHost` est appelée avec le
`sessionID` créé et persisté par **le serveur OpenCode officiel 2.0.32**.
La variante `scripts/g149-combined-page.mjs` est une copie du runner
G125/G130 validé, avec **trois lignes de hook uniquement**. Le script
original `scripts/smoke-combined-page.mjs` est conservé byte-exact pour
le garde de provenance `check-g119-cross-stream` ; cette séparation est
nécessaire pour ne jamais affaiblir les preuves antérieures.
Elle constitue un scope outil lié à cette session et au tour DOM réel,
crée des fichiers temporaires, un témoin et une clé **strictement locaux**
et configure l'orchestrateur G145. Au premier événement native RPC
`text seq=1`, le modèle attend :

1. Admission de JSON borné G138 / G133 et identité officielle de session ;
2. Autorisation/consentement **simulés par le host de test** ; les paramètres
   sont propres à la factory, jamais lus depuis la page ou le modèle ;
3. Journal `G140 consuming` fsync avant une vraie ouverture de fichier
   Linux par G135, puis deuxième contrôle des permissions ;
4. Confirmation du reçu d'outil, transaction `confirmed` durable ;
5. Accusé chiffré `G130` du **même événement RPC** et fsync, avant la
   diffusion du texte au serveur modèle local, aux événements SSE et à
   la session officielle. Les trois fragments et le terminal sont réels.

Le test relit le journal d'outil après un redémarrage réel du CLI,
vérifie l'identité, et tente de rejouer le même appel dans un autre
orchestrateur. Celui-ci doit refuser tout second effet. Les deux parcours
anormaux G125 (changement d'onglet, fermeture de page) restent terminalement
`cancelled`, sans faux SSE `DONE`, tout en conservant la preuve que
la lecture antérieure au défaut n'a pas été exécutée deux fois.

Les tests négatifs vérifient le refus de permission avant accès fichier,
la session forgée avant création et l'OS non Linux. Tous les comptes,
pages et conversations sont des fixtures localhost.

## Frontières explicitement non résolues

Ce test **n'installe aucun composant Electron Desktop** et n'exécute
pas le Core V2 expérimental patché **dans le processus du CLI officiel** :
celui-ci demeure non patché. Le modèle synthétique et le RPC G97
s'exécutent réellement dans le CLI officiel ; le host qui lit le
fichier et détient la clé/permission est un **processus de test externe**.
Il n'a ni permission native `Permission.Service.browserRead` signée par
le Core, ni attestation d'identité OS, ni preuve de révocation atomique
entre Core, driver et Chromium. Une réussite E2E de ce tour ne débloque
**aucun outil productif** : c'est une preuve de séquencement et de
raccordement des contrats dans un tour réel, pas une autorité native.

La sortie `src/index.ts` distribuée reste inerte et la distribution de
test G143 n'est pas une release commerciale. Aucun site tiers, compte,
cookie, API de fournisseur, `navigate`/`click`/`fill`/`submit`
ou écriture n'est exécuté.

Les indicateurs restent strictement :
`commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`,
`nativeDesktopElectronE2E=false`,
`atomicCoreChromiumRevocation=false`,
`commercialAutomationAuthorized=false`,
`webbridgeWritesEnabled=false`.
