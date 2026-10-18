# ADR 0104 — G152 : paquet racine réel et tour local complet CLI 2.0.32

**Statut : démonstration Linux du plugin officiel + host de test, NO-GO production.**
Nouveau worktree exclusivement depuis G150 #228 HEAD `cd01f129...`, CI
push/PR 9/9+9/9 verts ; port exact du module/test G148 déjà validé.

## Écart concret traité

G150 rendait le **vrai** paquet `src/index.ts` activable pour un modèle
et RPC synthétiques locaux. G149/G151 prouvaient le chemin DOM→outil→ACK→SSE
mais leur serveur officiel chargeait une archive G97 **distincte**.
Rien n'avait relié l'installation du root réel et ce tour de bout en bout.

## Nouveau contrat observable

Sous un unique profil jetable Linux, `proveActualEntrypoint` installe
le root compilé depuis son `.tgz` avec sources G97 vetées en ressource
interne ; il vérifie la configuration par défaut sans modèle, puis
relance un CLI officiel 2.0.32 non modifié avec le mode test explicite.
Le service synthétique modèle `127.0.0.1` appelle le RPC `submit`
enregistré par ce **même root chargé**, le compagnon ouvre et pilote
uniquement une page Chromium locale interdite aux autres URL, et
`take/progress/complete/poll` produisent trois vrais fragments DOM.

La session officielle `ses_...` est découverte via l'API du serveur ;
avant le premier fragment transmis au modèle, le host G149 valide
un JSON d'outil, obtient consentement de **fixture**, persiste l'opération
`consuming`, ouvre réellement un fichier temporaire Linux en lecture,
vérifie le reçu et confirme son journal. Le host G148 persiste chaque
événement dans un registre SSE chiffré / curseur HMAC ; le sink G130
fsync son ACK avant transmission au modèle. Après arrêt du serveur
officiel, une nouvelle instance officielle lit le message persistant
`finish:stop`, tandis que les journaux d'outil et SSE sont rouverts,
leurs scopes contrôlés et le rejeu **de l'effet** interdit.

Les contrôles G143 précédents (pack déterministe, SHA256/SHA512,
upgrade, rollback, archive altérée refusée et désinstallation du root)
restent requis sur le même SHA, ainsi que les tests Windows sans
Chromium et les gardes de provenance G119 du patch Core épinglé.

## Limites

Bien que le modèle/root et ses RPC soient dans le processus CLI officiel,
le contrôleur Chromium et l'ordonnanceur d'outils sont des **fixtures de
host de test externes** ; les callbacks de permission ne sont PAS
`Permission.Service` du Core, l'identité OS n'est pas attestée et le
patch expérimental Core V2 reste une autre exécution. Le Desktop Electron
distribué n'est pas testé. Les interfaces commerciales ChatGPT, DeepSeek,
Gemini, Qwen, Le Chat ne sont **jamais contactées** ; labels fournisseurs
de fixture et URL loopback ne sont pas des comptes connectés.

Gates inchangées :
`commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`,
`nativeDesktopElectronE2E=false`,
`atomicCoreChromiumRevocation=false`,
`commercialAutomationAuthorized=false`,
`webbridgeWritesEnabled=false`.
