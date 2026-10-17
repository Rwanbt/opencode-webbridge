# G47 — Patch natif combiné et récupération des cinq fixtures

**Instantané : 17 octobre 2026.** Toutes les PR sont **Draft/non fusionnées** ; l'application OpenCode officielle n'embarque pas ces modifications. Ces validations ne permettent d'activer **aucun** des cinq fournisseurs commerciaux.

| PR | SHA exact | Preuves contrôlées | Limite persistante |
| --- | --- | --- | --- |
| [#128](https://github.com/Rwanbt/opencode-webbridge/pull/128) | `d2ab4757343e4b2505ed08950169193aff383290` | RED→GREEN rejets des claims à getters/champs cachés dans les cinq adaptateurs hors ligne; 111/111 tests locaux; CI GitHub 6/6 (Windows inclus) | Un test de compte simulé n'est pas une authentification web réelle |
| [#129](https://github.com/Rwanbt/opencode-webbridge/pull/129) | `59f80d007945dfd7101d2e21aacffca942e6df0c` | Patch upstream `4617210822bdbb31e5749751afbfb4584ccedac8` combinant Core Permission.Service, BrowserLease, hooks/epochs, consentement exact, refus legacy snapshot, Desktop `read.commit`; Core 163/163, plugin-browser 48/48, 4 typechecks, CI 6/6 | **Pas** de révocation atomique entre consommation Core et effet GUI/IPC ; `requestOnce` interne et autres read tools non tous attestés; pas d'E2E Electron GUI distribué |
| [#130](https://github.com/Rwanbt/opencode-webbridge/pull/130) | `38f8371f8d8cb016479e234407421a95b757a956` | RED→GREEN validation des descripteurs de checkpoint/turn, aucun getter exécuté, aucun état partiellement restauré; 112/112 local; runs 39024894722 et 39024916893, **6/6 CI verte** dont Windows | Pas de journal WORM ni de transaction exactement-une-fois avec site distant |

Les branches #124 et #129 ne doivent pas être fusionnées naïvement : #129 **réintègre le contenu** de #124 dans un patch source rejouable depuis une base #123, sans en hériter comme ancêtre Git. La revue des différences doit être effectuée sur le **patch résultant**, non sur le nombre de PR vertes.

## Critères de non-activation

1. Consentement par appel et epoch valide ne suffisent pas tant que le pilote Desktop ne sérialise pas l'effet avec consommation unique et révocation. `navigate`, `click`, `fill`, `submit` restent **désactivés**.
2. Chaque voie de lecture, dont navigateur intégré, Code Mode, browser tools, connexions IPC directes et plug-ins, doit être vérifiée ou refusée. Les tests adversariaux doivent inclure sous-agent distinct, modification d'agent en vol, tab generation/reconnect, plugin policy mutation et reuse après crash.
3. La cible localhost Chromium/HTML du smoke n'est pas une preuve d'intégration Electron GUI. Le vrai Desktop officiel n'est pas certifié de bout en bout dans cette chaîne.
4. Les cinq sites commerciaux restent à **0/5** faute de conditions d'automatisation autorisant clairement l'usage. Aucun cookie/secret ne doit être capturé, ni CAPTCHA contourné, ni résultat simulé déclaré utilisable en production.

Registre : **9 épics, 54 stories, 66 issues**, dont 38 `partial`, 6 `blocked`, 10 `planned`; 23 critères documentés/fixturés et **0 story acceptée production**. Aucun merge n'est autorisé dans cette phase.
