# ADR 0103 — G151 : reprise SSE dans un tour CLI et frontière OS vérifiée

**Statut : tests positifs localhost Linux, autorité Core/Desktop NO-GO.**
Nouveau worktree isolé basé exclusivement sur G149 #225 SHA 2daa581,
CI GitHub 9/9 push + 9/9 PR déjà verts. Aucun merge/upstream/app installé.

## Travaux intégrés

- **G147 #226** : script de preuve de l'API officielle CLI2.0.32,
  attestant négativement qu'un client HTTP externe ne possède pas de
  `nativePrincipal` ou `verifiedDesktopPeer` dans le contexte RPC.
  Le faux jeton « Electron » n'y confère donc aucune autorité.
- **G148 #227** : source et tests exacts du host SSE de lecture seule,
  utilisant le journal d'ACK chiffré G127 + checkpoint G121, curseur
  HMAC par session/compte/onglet/génération/turn, refus de rejeu d'effet.
- **G149 #225** : même tour réellement lancé avec un paquet G97 de test
  chargé par l'OpenCode officiel 2.0.32. Le premier événement DOM/RPC
  déclenche le vrai `file.read` Linux avec journal G140 puis le G130
  encrypted fsync ACK, avant diffusion du modèle/SSE.

## Nouveau parcours positif Linux à qualifier

Le host G151 lie **la même session native** à un deuxième journal
SSE et checkpoint. Chaque événement RPC est validé, d'abord commité
dans le journal SSE, puis dans le sink G130 avant la transmission à
la réponse modèle. Un événement rejoué après une panne/ACK perdu
est un doublon de lecture **sans second accès au DOM ni exécution
d'outil**. Après arrêt/redémarrage du host du CLI, le test ouvre
les reçus persistés, vérifie l'ensemble des deltas/terminaux,
une reprise depuis le dernier curseur vide et le refus d'une autre
identité de compte. Les parcours de fermeture réelle Chromium et
de changement d'onglet doivent conserver `cancelled` plutôt que
fabriquer un `finished`.

Le script de G147 est exécuté **dans le même job CI Linux** pour
éviter l'interprétation erronée que les reçus signés de fixture
constituent une attestation OS.

## Claims interdits

Le paquet G97 reste une **fixture modèle locale**, le host G151
un processus de test distinct du Core non patché du CLI.
Les assertions ne sont pas celles du vrai Desktop Electron packagé,
et ni l'identité de processus natif ni la révocation Core→Chromium
atomique n'est prouvée. Le root distribué du G150 n'est pas importé
par cette branche : aucun compte web commercial n'est contacté.

`commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`,
`nativeDesktopElectronE2E=false`,
`atomicCoreChromiumRevocation=false`,
`commercialAutomationAuthorized=false`,
`webbridgeWritesEnabled=false`.
