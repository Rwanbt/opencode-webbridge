# G55 — État des preuves natives et des outils après #139

Instantané du **17 octobre 2026**. PR **Draft, non fusionnées** ; aucun fournisseur commercial actif (0/5) et **zéro critère accepté en production**. Les fixtures et les patches OpenCode épinglés ne sont pas une distribution Desktop certifiée.

| PR | SHA vérifié | Preuve | Limite |
| --- | --- | --- | --- |
| [#135](https://github.com/Rwanbt/opencode-webbridge/pull/135) | `02238aa95b7206ad86e260f77360cf9a1c074653` | Registre des preuves NO-GO Core/Desktop et tests Windows | Documentaire uniquement. |
| [#136](https://github.com/Rwanbt/opencode-webbridge/pull/136) | `705b0fcc2c70fe06183d34cb211503ac82e02469` | Requête de tour détachée/figée avant callback d'adaptateur ; 114/114 local ; CI runs 39028839166 et 39028851815, **3/3 chacun** | Limite aux fixtures et interfaces partagées, aucune connexion commerciale. |
| [#137](https://github.com/Rwanbt/opencode-webbridge/pull/137) | `e5ef3536d4b744ded86d0f3d2be9c52fe083b03b` | Lecture Core `BrowserLease.current` vérifiée au `read.commit` et au retour ; refus GUI d'un snapshot IPC sans ticket et d'une autre action avec ticket de lecture ; patch épinglé applicable ; runs 39029918597 et 39029921192, **3/3 chacun** | Première version `f32bad8` a échoué (signature TypeScript `read` incohérente) puis corrigée ; **revocation Core après commit et avant effet Chromium NON atomique**. Aucun E2E Electron distribué. |
| [#138](https://github.com/Rwanbt/opencode-webbridge/pull/138) | `7cf27da9cfa315caf88e7dcc335c831bf2ac2641` | Contexte binding/gate/consent capturé strictement avant callbacks ; getters, identités mutables et métadonnées cachées refusés ; 117/117 local ; runs 39029844143 et 39029855238 **3/3 chacun** | Une même extension JavaScript hostile capable de muter le runtime entier reste hors TCB prouvé. |
| [#139](https://github.com/Rwanbt/opencode-webbridge/pull/139) | `f03da0dac161cf9b22352893bc35598f316144c2` | RED : accessor `array[0]` réellement exécuté lors de `safeJSON`, avant toute permission. GREEN : lecture par propre descripteur, 118/118 tests locaux. | CI GitHub à confirmer sur SHA ; ce test ne prouve pas la permission transactionnelle Desktop. |

## GO/NO-GO explicite

La [PR #132](https://github.com/Rwanbt/opencode-webbridge/pull/132) reste un **contrôle statique NO-GO**, pas un test dynamique Chromium ni une mitigation. [#129](https://github.com/Rwanbt/opencode-webbridge/pull/129) et [#137](https://github.com/Rwanbt/opencode-webbridge/pull/137) améliorent la vérification des tickets et ferment la voie `snapshot` sans commit à la frontière GUI ; elles ne fournissent **pas** l'atomicité interprocessus entre `Permission.Service`, les mutations d'epoch et la primitive réelle `browserControl`. Le runtime de lecture indirect et d'autres outils historiques doivent encore être inventoriés et clôturés. Une fermeture côté GUI exige un TCB host/driver sérialisant permission, commit et début d'effet, avec test dynamique de révocation dans la fenêtre, et des reçus après crash.

Les opérations natives `navigate`, `click`, `fill`, `submit` ne sont **pas autorisées par cette extension**. Aucun appel au compte grand public ChatGPT, DeepSeek, Gemini, Qwen ou Mistral n'est activé. Les outils, Git et sous-agents n'exécutent jamais directement les propositions de texte web ; la preuve d'intégration de permissions native de bout en bout reste manquante. Aucun fournisseur ne passe du statut bloqué à accepté en raison de ces CI.

Registre maintenu : **9 épics, 54 stories, 66 issues (3 jalons), 38 partielles, 6 bloquées, 10 planifiées, 23 fixture/docs-evidenced et 0 production-accepted**. Aucun merge, release ou modification d'Unifia ou du dépôt officiel distant.
