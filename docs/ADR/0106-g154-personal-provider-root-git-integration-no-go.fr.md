# ADR 0106 — G154 : activation individuelle et véritable paquet CLI/Git réunis

**Décision : intégrer sans fusionner #231 à la base #232 ; production NO-GO.**

## Chaîne conservée

La branche G154 part de #232 (G153, qui prolonge #230/G152) et applique le
delta vérifié de #231 depuis leur ancêtre commun #228, sans réécrire les
fixtures G119 épinglées. Le **même SHA de branche** contient maintenant :

- le véritable `src/index.ts` empaqueté en `.tgz` et installé dans un profil
  OpenCode CLI officiel 2.0.32 jetable ;
- un modèle local activable uniquement par opt-in de test, une page Chromium
  localhost, DOM→RPC→SSE, ACK chiffré durable, reprise après redémarrage ;
- les parcours `file.read`, `git.status`, `git.diff`, `git.log` réellement lus
  dans des répertoires temporaires sur Linux, sous permission **host simulée**,
  refus du rejeu et des écritures ;
- la validation d'activation **par fournisseur**, fondée sur le choix individuel
  et des capacités vérifiées, sans barrière d'autorisation commerciale globale.

Les travaux préexistants de #232 et #231 avaient des CI distinctes : G154
exige leur exécution dans une **seule CI sur un HEAD final exact**, notamment
les jobs Linux G152/G153, les tests de politique et les refus Windows.

## Frontières impératives

Une entrée `approved/permitted` avec des capacités injectées dans un test ne
prouve **pas** l'accès à un compte, ni un transport réel vers ChatGPT,
DeepSeek, Gemini, Qwen ou Mistral. Le modèle G150 reste exclusivement une
fixture locale ; les cinq fournisseurs web sont toujours **0/5 opérationnels**.
La permission d'outil host est simulée : elle n'atteste pas un principal
Desktop/OS. Le patch natif est contrôlé sur un autre Core source, il n'est pas
exécuté dans l'application Electron distribuée. Aucune écriture navigateur,
aucune lecture de cookie ou de token, aucun changement d'OpenCode officiel.

La prochaine activation doit relier une session navigateur volontaire de
l'utilisateur, un driver réel, un adaptateur observé, l'autorité effective et
le flux SSE au même tour. Chaque permission sensible et chaque changement de
session/onglet doivent pouvoir interrompre le flux sans rejouer un envoi
incertain. D'ici là : zéro story L3 acceptée et release NO-GO.
