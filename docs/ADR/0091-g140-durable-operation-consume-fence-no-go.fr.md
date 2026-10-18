# ADR 0091 — Journal anti-rejeu durable des effets d'outils (G140)

**Statut : prototype hors ligne S03/T03, production NO-GO.**
Base G136 #213, nouveau worktree indépendant, aucune modification de la
distribution officielle OpenCode ou des modules G137/G138/G139/G134.

## Problème concret

Le verrou `ToolBroker.consume()` G136 est volontairement **en mémoire**.
Si le processus meurt après l'admission et avant ou pendant l'effet, un
nouveau processus ne peut pas supposer que l'effet n'a jamais eu lieu.
Une confirmation qui échoue ne doit pas autoriser de replay automatique.

## Prototype et invariants

`DurableOperationFence` conserve un **seul** effet dans un store lié par
HMAC à l'identité exacte session/agent/turn/workspace/opération/hash du
projet. Le fichier ne contient pas les valeurs d'identité, les prompts,
les textes, les cookies ou les résultats de l'outil.

Phases : `reserved → consented → consuming → confirmed | uncertain`, avec
`cancelled` seulement avant consommation. Chaque transition est écrite
avec fichier temporaire exclusif, fsync et rename ; fsync répertoire sous
Unix, témoin signé dans un autre répertoire, comparaison constante des MAC
et verrou exclusif. Une panne entre le journal et le témoin crée une
discordance **NO-GO, réconciliation opérateur obligatoire**. Le journal
est rouvert uniquement s'il existait : jamais de remise à zéro silencieuse.

Après reprise en phase `consuming`, ni `consume` ni `consent` ni
`cancelled` ne peut conduire à une nouvelle tentative. `confirm()`
requiert une fonction de vérification supposée provenir du host de
confiance ; `false` et exception produisent un résultat explicite
`uncertain`, terminal. Les tests réels confirment le comportement au
redémarrage, l'exclusivité, la détection de rollback, la liaison de scope
et le refus des chemins liés.

## Portée et obstacles

Le journal est un **composant offline autonome**, pas encore relié au
`runAuthorizedEffect` réel ni à un éventuel Core OS-trusted. La fonction
`verify` peut être simulée dans un test et ne constitue **pas** une
attestation native. La clé de signature doit être fournie et protégée
par un futur SecretBroker ; témoin indépendant = répertoire distinct dans
les tests, pas un authentique support anti-rollback OS.

Le lock orphelin après crash exige réconciliation humaine et vérification
de l'absence de propriétaire actif avant son nettoyage. Windows n'offre
pas ici de fsync de répertoire ; la résistance à une panne matérielle ou à
un adversaire disposant du système de fichiers et de la clé n'est pas
démontrée. Les symlinks des répertoires parents et courses de renommage
requièrent un broker de handles OS fiable.

Gates inchangées : OS/Electron E2E non prouvée, effet natif non autorisé
pour la distribution, fournisseurs 0/5, acceptedStories 0/54, browser
writes OFF. Ce lot **n'accepte pas** US-E3-04 en production.
