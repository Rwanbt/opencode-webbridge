# ADR 0102 — G150 : véritable plugin racine installable, modèle/RPC local opt-in

**Décision : OFF par défaut, test localhost explicite uniquement ; production NO-GO.**
Branche/worktree G150 isolés sur #225 vérifié, aucun changement du binaire
OpenCode officiel, du patch natif G131, des scripts G125/G130 épinglés,
des adaptateurs commerciaux ni des worktrees des autres agents.

## Différence de fonctionnalité prouvée

G143 installait le **vrai** `src/index.ts` mais ce root ne pouvait jamais
sélectionner un modèle ni enregistrer le moindre RPC : tous les tests
positifs de modèle G125/G149 utilisaient le package séparé G97. Désormais,
le point d'entrée réel expose une activation strictement optionnelle :

1. Sans drapeau explicite, `setup(ctx)` retourne sans aucun effet ni modèle.
2. Avec `WEBBRIDGE_G150_LOCAL_FIXTURE=1`, témoin de contexte de test
   indépendant, secrets éphémères de 256 bits et une URL **strictement**
   `http://127.0.0.1:port/v1`, charge la copie intégrale du plugin de
   fixture G97 veté dans **la même archive root**.
3. Le CLI officiel **2.0.32 non recompilé** installe le root depuis
   `.tgz` et vérifie sur l'API officielle l'enregistrement du modèle
   `webbridge-fixture/webbridge-native-fixture`, un RPC signé non
   rejouable, puis la sélection de ce modèle et ses deltas SSE d'un
   serveur d'inférence synthétique local. L'absence de drapeau est testée
   séparément dans une installation native fraîche.
4. `npm pack` vérifie SHA256/SHA512 reproductibles, SDK épinglé et
   fichiers exacts, upgrade/rollback/tamper/uninstall dans un profil
   jetable. Les tests Windows se limitent à l'archive et aux refus
   malformés sans Chromium ni modification du PC.

## Limites

Le module importé est la **fixture G97 inchangée**, incluse dans un
artefact de distribution temporaire sous le nom `g97-local.mjs` ; il
ne contacte jamais ChatGPT/DeepSeek/Gemini/Qwen/Mistral et n'accède à
aucun navigateur commercial. Il n'existe aucune autorité native OS,
aucune permission Core/driver atomique, ni processus Desktop Electron
packagé ainsi vérifié. Le CLI contient seulement le Core officiel
non patché ; le patch expérimental Core G131 est testé indépendamment.

Ce lot constitue un modèle local utilisable dans le **vrai plugin externe**,
pas un fournisseur commercial opérationnel et encore moins une
acceptation de story en production.

`commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`,
`nativeDesktopElectronE2E=false`,
`atomicCoreChromiumRevocation=false`,
`commercialAutomationAuthorized=false`,
`webbridgeWritesEnabled=false`.
