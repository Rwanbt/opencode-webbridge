# G3 — Canal RPC natif pour un futur navigateur compagnon

**17 octobre 2026 — preuve technique validée, aucun navigateur réel connecté.**

## Ce qui est désormais démontré

Le plugin serveur OpenCode 2.0.29 peut enregistrer une API RPC via `ctx.rpc.register`, et un client local peut l'appeler par les routes officielles `/api/rpc/{rpcID}/{method}`. L'expérience de test fonctionne sur une instance de serveur OpenCode démarrée avec un profil temporaire, un mot de passe distinct et une écoute locale sur `127.0.0.1`.

```sh
npm run smoke:rpc
```

Résultat attendu et observé sous Windows : `G3 native OpenCode RPC relay: PASS (submit -> take once -> complete -> result)`.

La preuve comprend l'envoi d'un prompt synthétique, la prise unique de la tâche par un client, le refus d'un jeton erroné, la livraison d'une réponse synthétique et la consultation du résultat. Le même smoke est ajouté au pipeline Linux.

## Sécurité et frontière des responsabilités

`RpcRelayPort` est une file locale bornée et **éphémère**. Le secret de capacité a 256 bits et doit correspondre au propriétaire de l'onglet, du compte fictif, du fournisseur et de la session. Une tâche déjà prise en charge n'est jamais redistribuée implicitement. Elle refuse les réponses vides/trop longues et ne permet pas de navigation, d'exécution de commande ni d'accès aux cookies. L'API RPC est activée **uniquement** dans `src/testing/native-rpc-relay-plugin.ts` avec `WEBBRIDGE_RELAY_ENABLE=1` et un secret fourni au processus.

Le contrôle d'accès du serveur OpenCode s'ajoute au secret RPC ; l'environnement de test n'hérite pas des clés GitHub/IA ni de la configuration utilisateur. Le serveur est arrêté et les fichiers temporaires sont supprimés après le test.

## Ce qui reste à faire

Le SDK public ne propose toujours pas de `ctx.browser`. L'existence d'une API RPC permet à un composant client **d'échanger** avec le fournisseur, mais ne lui donne pas magiquement la capacité de contrôler le navigateur intégré. Il faudra une véritable intégration OpenCode Desktop/TUI disposant de cette autorité avec l'accord de l'utilisateur — ou une API publique ajoutée par OpenCode. Aucun composant ne doit intercepter ou exporter une session de site web.

Il faudra également un journal durable (l'état RPC est actuellement volatil), un mécanisme de pairage sécurisé et expirant, une vérification des origines et des permissions, l'arrêt et la reprise après incident, des tests de concurrence, ainsi que l'évaluation des conditions propres à ChatGPT, Gemini, DeepSeek, Qwen et Mistral. Ces cinq adaptateurs restent désactivés. **Ce lot n'est pas un fournisseur web utilisable.**
