# G44 — Avancement sécurité native, permissions et transport

Instantané du 17 octobre 2026. Toutes les PR ci-dessous sont **Draft et non fusionnées**. Les preuves de source patchée ne représentent **pas** une version officielle du Desktop. Les cinq services commerciaux demeurent désactivés (0/5) ; pas de clé API et pas d'automatisation non autorisée.

| PR | SHA exact | Preuves disponibles | Ce que cela **ne prouve pas** |
| --- | --- | --- | --- |
| [#120](https://github.com/Rwanbt/opencode-webbridge/pull/120) | `d1147fb60cf431a6ae065c3515616012aedc2420` | RED→GREEN mutation hook politique et état Agent; patch officiel épinglé, CI 6/6 | Toute mutation de fermeture hook, provenance appelant, transaction Desktop |
| [#121](https://github.com/Rwanbt/opencode-webbridge/pull/121) | `5b283bd2e2fdf52d3197f82263905df0abe23dba` | Claim+tour figés avant await, tests 106/106, CI 6/6 | Accès à un compte ChatGPT/DeepSeek/Gemini/Qwen/Mistral |
| [#122](https://github.com/Rwanbt/opencode-webbridge/pull/122) | `4b00592cf195ddaa904d661f47b3db7d944911ef` | Accesseurs de messages non évalués, 107/107, CI 6/6 (Windows inclus) | Sécurité de tous les points d'entrée JavaScript du Desktop |
| [#123](https://github.com/Rwanbt/opencode-webbridge/pull/123) | `624423a1e7a2663a7dc94e011284be9cdfcda8c9` | Saved wildcard ne remplace plus un consentement par appel pour browserRead; Core 152/152, CI 6/6 | Autorisation transactionnelle avec effet GUI ou droits d'écriture |
| [#124](https://github.com/Rwanbt/opencode-webbridge/pull/124) | `66fa5619e9135c52a4a1b28de67ecd5ba81c944b` | Core browserRead issue/consume requis par snapshotOnce; anciens `snapshot` et `target(snapshot).request([])` bloqués; Core 21/21, plugin-browser 48/48; CI 6/6, patch upstream `4617210` applicable | **Pas** d'atomicité Core→Desktop, voies internes premières parties non attestées, autres browser tools non couverts; correctifs #120/#123 non convergés dans ce patch |
| [#125](https://github.com/Rwanbt/opencode-webbridge/pull/125) | `b43286c1b68849baa28b9e93edd5122c63be0b8c` | Deux tests négatifs RED→GREEN : claim RPC à getters/champs cachés, mutation owner du caller; 109/109 tests, CI 6/6 | IPC navigateur natif complet |
| [#126](https://github.com/Rwanbt/opencode-webbridge/pull/126) | `98c30b06b76d47e3b3bc7329f9e6aa18dca9ec00` | Réponses RPC révoquées après `release`/re-claim, génération monotone et contrôle après await; 110/110 local | **CI GitHub en cours au moment de cet instantané**, pas de preuve transactionnelle externe |

## Conditions de passage suivantes

1. **Convergence et E2:** assembler #120/#123/#124 dans un patch complet contre le commit `4617210822bdbb31e5749751afbfb4584ccedac8`, refaire revocation/races, cross-agent, workspace, plugin activation, connexion et génération d'onglet. Le chemin `BrowserConnection.requestOnce` premier-parti et tous les autres read tools/IPC doivent être audités, rejetés ou soumis au même mandat.
2. **Ordre atomique:** maintenir toutes écritures navigateur `navigate`, `click`, `fill`, `submit` **désactivées** tant que le host GUI n'offre pas une transaction qui consume le bail, réévalue la politique, exécute l'effet sans faille TOCTOU et émet un receipt durable avec état incertain non rejouable.
3. **E2E réel:** un test Chromium localhost ne prouve pas la GUI Electron/OpenCode Desktop officielle; les smokes Windows/Linux et tests upstream sur le commit exact ne certifient pas automatiquement l'utilisation dans le Desktop distribué.
4. **Outils et fournisseurs:** l'intention d'outil du DOM reste une donnée non fiable; terminal/Git/sous-agents exigent une autorité native distincte. Les conditions commerciales prohibitives ou non vérifiées priment sur tout consentement utilisateur. Aucun statut `production-accepted` n'est justifié.

La matrice reste 9 épics, 54 user stories, 66 issues (dont trois milestones), 38 `partial`, 6 `blocked`, 10 `planned`, 23 avec preuves docs/fixtures, **zéro acceptée production**. Le problème historique Windows `0x800705AF` concerne la mémoire hôte, et non une régression GitHub CI démontrée.
