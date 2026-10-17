# G39 — Preuves de lecture native et conditions de non-activation

Instantané au 17 octobre 2026. Toutes ces PR sont **Draft, non fusionnées**, et leurs tests ne prouvent **ni l'utilisation dans un OpenCode Desktop distribué ni l'accès autorisé aux chats commerciaux**. Le registre réintègre également les références #108 (documentation) et #109 (interdiction d'extraction automatisée du chat Qwen grand public), sans débloquer la story commerciale correspondante.

| PR | SHA exact | Validation vérifiée | Portée / limite |
| --- | --- | --- | --- |
| [#114](https://github.com/Rwanbt/opencode-webbridge/pull/114) | `dc803a1a03661ccbb9b7aea962f38ba19937ede1` | Tests Core 39/39; patch officiel `4617210` appliqué; runs 39021204577 et 39021241786, 3/3 jobs chacun | `Permission.Service.browserRead` est une référence **lecture seule**, pas encore reliée à Desktop; l'identité de l'appelant n'est pas attestée de bout en bout. |
| [#115](https://github.com/Rwanbt/opencode-webbridge/pull/115) | `fedebe2263de8fa584a9228806d9030d49f63e9b` | Plugin-browser 47/47; Chromium local fake-chat `smoke:local-read` OK; runs 39021214444 et 39021254251, 3/3 | `read.commit` de Desktop est un mécanisme isolé; les appels historiques `requestOnce` peuvent suivre une autre route. Timeout `smoke:page` Windows local **non résolu**. |
| [#116](https://github.com/Rwanbt/opencode-webbridge/pull/116) | `fb7ae7bb46ba16656646ba480fcf6f05b92c9f58` | Runs 39021377607 et 39021380712, 3/3 | Documente #110–#113 sans accepter les critères production. |
| [#117](https://github.com/Rwanbt/opencode-webbridge/pull/117) | `130fc4bd08435f267285e9bfce9c099622049181` | Tests WebBridge 104/104; runs 39021580080 et 39021582805, **3/3 chacun (Windows inclus)** | Exceptions source opaques, mais autres frontières de divulgation et identifiants restent à auditer. |
| [#118](https://github.com/Rwanbt/opencode-webbridge/pull/118) | `3b00af1af4a799369605634d492b3ab2ff7742b8` | Patch Core+Desktop combiné applicable à `4617210`; tests Core 39/39, browser 47/47, loopback local read; runs 39021910440 et 39021948105, 3/3 chacun | **Convergence de patches, pas branchement transactionnel.** `browserRead` n'est pas relié à `snapshotOnce` / `read.commit`. |

## Invariants non encore démontrés

1. Chaque chemin de lecture Desktop, y compris `requestOnce('snapshot')`, doit passer par l'autorité Core native; une nouvelle méthode optionnelle ne doit pas laisser un ancien chemin non protégé.
2. La provenance de l'agent, du plugin, du tour et du call doit être authentifiée par l'hôte et liée à la session, au workspace, à la connexion Desktop et à la génération de l'onglet; aucun champ d'autorité venant d'une page web ou d'un plugin non fiable ne peut être accepté tel quel.
3. Une mutation de politique, de hook de permission, de session ou de génération pendant `await` et avant effet doit rendre le ticket inutilisable; révision et `live()` doivent couvrir toutes les routes, y compris les modifications hors registres connus.
4. Pour les écritures `navigate`, `click`, `fill`, `submit`, il manque une section critique **atomique côté hôte** qui joint consommation unique, politique fraîche, action exacte et effet GUI, plus accusé/journal durable et état `uncertain` après échec post-commit. **Écriture interdite** jusque-là.
5. Un test Chromium Playwright localhost reste distinct d'un E2E de la vraie GUI Electron OpenCode; le patch n'est pas incorporé au produit distribué. Les cinq fournisseurs commerciaux restent **0/5 activés** en l'absence d'autorisation d'automatisation établie.

L'audit E2 indépendant sur les hooks de politiques est en cours hors de cette branche. Aucune de ses conclusions non publiées n'est considérée ici comme certifiée. Mettre à jour le registre par PR séparée après SHA et CI exactes. L'incident de mémoire paginée PowerShell `0x800705AF` n'était pas une erreur GitHub Actions; tous les jobs Windows de #117 se sont terminés avec succès.
