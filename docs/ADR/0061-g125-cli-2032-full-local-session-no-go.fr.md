# ADR 0061 — G125 : intégration CLI officielle 2.0.32, Chromium local et persistance

**Statut : validation ciblée CI Linux, NO-GO Desktop/production.** Le lot étend G99/G100/G113 (CLI 2.0.29) et D01 #200 (CLI 2.0.32, RPC et modèle sans DOM). Il n'extrapole aucune preuve de ces lots : son nouveau job Linux installe **exactement `@opencode/cli@2.0.32`** et échoue si `opencode --version` diffère.

## Parcours réellement testé

`npm run smoke:g125-native` crée un profil XDG isolé, installe un **unique plugin `.tgz`** (`opencode.webbridge.g97-combined-test`), le met à jour puis le restaure. Chaque exécution active **le même plugin** pour `provider.transform` et `ctx.rpc.register`; `/api/plugin` confirme son activation exclusive. Le CLI choisit `webbridge-fixture/webbridge-native-fixture`, le modèle local envoie un prompt, un navigateur Playwright Chromium autonome lit une page HTML **strictement `127.0.0.1`**, les fragments DOM passent par `RPC submit/take/progress/poll/complete`, puis par le serveur local OpenAI-compatible et ses fragments SSE. Les deux exécutions nominales (upgrade/rollback) vérifient exactement trois fragments DOM et SSE et une réponse finale reconnue par le CLI.

Pour chacune, le test relève l'ID de session réellement créé via **`GET /api/session`**, recoupe la sortie JSON du CLI si présente et vérifie l'historique officiel **`GET /api/session/{id}/message`** : prompt utilisateur présent et texte assistant achevé. Il **arrête le serveur natif** puis relance un nouveau processus `opencode serve` sur le même profil/port et relit la session et son historique. La lecture après redémarrage, et non un simple compteur mémoire, atteste cette persistance.

Deux fautes sont reproduites **après le premier fragment DOM et le premier SSE réel** : navigation vers `about:blank` (tab-change) puis fermeture effective de l'onglet (browser-disconnect). Le RPC passe à l'état terminal `uncertain/cancelled`, refuse ensuite progress, complete, submit et second uncertain. L'output CLI est interrompu, aucun SSE `[DONE]` ni réponse fabriquée n'est émis. La session persiste après relance du serveur, mais son historique ne peut contenir de réponse assistant achevée issue de ce DOM devenu incertain.

## Limites et décision

Tout se déroule uniquement en **Linux CI hébergé**, avec Chromium headless jetable. Aucune session Electron empaquetée, browser intégré Desktop, site tiers, cookies ou comptes commerciaux n'est utilisée. `opencode 2.0.32` atteste le CLI, pas le Desktop. Les capacités upstream `read.commit/read.live`, identité d'appelant et permission GUI ne sont pas rendues publiques par ce test. Les cinq fournisseurs commerciaux restent **0/5**, les écritures navigateur restent **OFF**, aucun résultat n'est homologué production. L'acceptation GUI Desktop, le consentement effectif et l'automatisation des services commerciaux restent **NO-GO**.

Un échec de session restaurée, un faux résultat final ou un modèle chargé depuis un deuxième paquet rend le job **rouge**. Les tests précédents de la branche parente continuent de cibler 2.0.29 comme annoncé.
