# G50 — Revocation Desktop, smoke Windows, intégrité des événements

Instantané au 17 octobre 2026. Toutes les PR sont **Draft/non fusionnées**, hors de la distribution officielle OpenCode Desktop ; aucune story acceptée production, aucune écriture native et **0/5** adaptateurs commerciaux utilisables.

| PR | SHA exact | Preuves | Limite |
| --- | --- | --- | --- |
| [#132](https://github.com/Rwanbt/opencode-webbridge/pull/132) | `ac6c8f2f55b121817927fc43c0a971bd9fe668cb` | ADR et vérificateur statique de la fenêtre de révocation Core-consume→Desktop-read.commit; CI upstream 6/6 | Un script qui détecte la faille **ne la corrige pas** et n'est pas un test RED→GREEN d'un vrai effet GUI |
| [#133](https://github.com/Rwanbt/opencode-webbridge/pull/133) | `d254af48fc7e011d496bfbba59309373bfd65e5c` | Après échec Windows `smoke:page` job 117375373922 de #131, troisième handshake **lecture seule GET**, borné et avant tout effet ; test ciblé et 105/105 local ; runs 39025775222 et 39025884129, CI 6/6 dont Windows | La CI #131 garde **un job FAIL** historique, succès ultérieur de #133 n'efface pas la preuve ; jamais de retry de `run` après résultat incertain |
| [#134](https://github.com/Rwanbt/opencode-webbridge/pull/134) | `4cc45e445ff26b0c891cca7620732a703ea41f7b` | RED→GREEN : évite getters et champs cachés dans les événements partial/terminal d'adaptateurs ; captures strictes figées, 113/113 local | CI GitHub en cours au snapshot ; pas de provider commercial branché, ni preuve Electron GUI |

## Décision maintenue

Le patch combiné [#129](https://github.com/Rwanbt/opencode-webbridge/pull/129) valide Core `Permission.Service.browserRead`, `BrowserLease`, hooks epochs, consentement par appel et Desktop `read.commit`, mais **ne sérialise pas de manière atomique** le retrait de permission avec l'effet Chromium. L'appel interne premier-parti et d'autres outils de lecture ne sont pas tous attestés. La surveillance de la révocation au commit n'est pas une garantie à l'instant de l'effet. Des tests dynamiques adversariaux doivent suspendre après consumption et après commit, retirer la permission et prouver zéro invocation de la primitive Chromium. En attendant : refus par défaut, aucune écriture native, aucun fournisseur commercial actif.

`planning/progress.json` conserve **9 épics, 54 stories, 66 issues**, 38 partielles, 6 bloquées, 10 planifiées, 23 critères documentés ou fixturés, **0 production-accepted**.
