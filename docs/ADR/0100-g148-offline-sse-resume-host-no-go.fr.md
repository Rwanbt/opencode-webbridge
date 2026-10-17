# ADR 0100 — G148, livraison SSE hors ligne avec reprise après ACK perdu

**Décision : preuve de transport de fixture uniquement ; NO-GO production, Core et Desktop.** Base exacte : PR Draft #224, `05cf830d1f0601ae93e083f2533a85d5363c0e30`. Le paquet OpenCode officiel et les services commerciaux ne sont pas sollicités.

## Frontière et contrat

`src/testing/offline-sse-resume-host.ts` relie les **deux journaux existants** :

- `DurableReadAckSink` G127/G130 : ACK des fragments de lecture en AES-256-GCM, `fsync`, témoin HMAC indépendant, refus de double contenu, ordre strict, terminal et portée complète.
- `DurableReadCheckpoint` G121 : identité à sept composantes, dernier fragment confirmé, génération, horodatage signé et fenêtre maximale de 30 s.

Un `acknowledgeRead` s'effectue avant que le fragment puisse apparaître dans la livraison SSE. Si l'ACK réseau est perdu après `fsync`, la même trame renvoyée **uniquement au sink** reçoit `duplicate` sans nouvelle écriture, sans nouvelle opération modèle, outil ou navigateur. La sortie `replay` ne lit que `sink.readAll()` ; aucun `submit`, `navigate`, `click` ou RPC navigateur n'est exposé. Lors d'une coupure entre le `fsync` ACK et le checkpoint, l'ouverture suivante rapproche uniquement les fragments déjà persistés et leurs numéros.

Chaque champ `id:` SSE est un curseur `v1.<seq>.<HMAC-SHA256>` calculé sur le tuple identité/turnID, l'index et le préfixe intégral des événements confirmés. Le client renvoie cet identifiant inchangé via Last-Event-ID. Les séquences futures, les graphies non canoniques, le HMAC falsifié, les propriétés supplémentaires ou accesseurs sur l'identité, le compte, la session et les générations différents sont refusés. Les lignes SSE sont formées d'un événement connu et de `JSON.stringify` (retours à la ligne échappés).

L'hôte fixe 30 000 ms depuis l'horodatage signé du checkpoint, 24 576 octets UTF-8 par réponse, 64 événements par lot. Un événement plus gros que le budget demandé échoue ; si la réponse remplit son budget, l'identifiant du dernier événement livré permet la page suivante. Le sink amont limite déjà chaque texte, le nombre d'événements et le total enregistré.

## Preuves adversariales

Sur **de vrais répertoires temporaires**, tests Node compilés TypeScript :

1. Le listener disparaît après ACK durable et avant réception SSE ; fermeture/réouverture avec mêmes chemins, clé, session et génération ; doublon idempotent byte-for-byte dans l'enveloppe chiffrée et son témoin ; retransmission des **données uniquement** à partir du curseur signé, puis déduplication de l'événement déjà reçu.
2. Portées multi-comptes, session différente, rotation d'onglet ou de connexion, accesseurs malveillants, curseur altéré, index inexistant, entrée non canonique : refus fermés.
3. Lacune séquentielle, même séquence avec contenu divergent, autre turn, trame trop longue, post-terminal, fenêtre expirée, dépassement de taille SSE : refus.
4. ACK chiffré écrit sans checkpoint (coupure simulée), puis reprise des **seuls événements durables** sans ingestion distante.
5. Chiffrement modifié avec témoin inchangé : aucune ouverture/relecture.
6. Checkpoint signé avançant au-delà du dernier reçu durable : refus de reprise sans saut silencieux de données ; état terminal incohérent également refusé.

La CI `checks` Linux et `windows-progressive-relay` exécutent directement le même test après compilation, en complément du `npm test` global.

## Limites expressément conservées

Ce hôte est un **simulateur local** doté d'une identité injectée par le banc d'essai. Les secrets et la portée du cursor HMAC n'attestent pas le principal OS, ne valident pas les permissions Desktop/Core et n'établissent aucun consentement commercial. La « lecture exactement une fois » désigne uniquement l'unique reçu durable par `(identité, turnID, seq, contenu)` ; SSE demeure une livraison **au moins une fois** jusqu'à l'ACK du consommateur. Un listener tué pendant sa propre application peut voir une répétition ; le client doit dédupliquer `id`. Une perte d'ACK avant persistance, un état de journal incertain, un verrou après mort du processus producteur ou une corruption des deux témoins indépendants requièrent une réconciliation opérateur ; aucune retransmission d'effet n'est autorisée.

Décisions maintenues : `commercialProvidersOperational=[]`, `productionAcceptedStoryIDs=[]`, `nativeDesktopElectronE2E=false`, `atomicCoreChromiumRevocation=false`, `commercialAutomationAuthorized=false`, `webbridgeWritesEnabled=false`. Intégrer réellement au modèle SSE/IPC OpenCode exige la provenance native de G147, les autorisations Core et une preuve Desktop externe.
