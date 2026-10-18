# G7 — Réconciliation explicite des tours incertains

**Périmètre :** commande opérateur hors ligne pour le relais de test OpenCode 2.0.29. Aucun service commercial, navigateur connecté, cookie ou session réelle.

## Règles de sécurité

Après crash, G6 conserve `prepared` (enregistré mais remise incertaine) ou `leased` (remis au compagnon mais effet distant potentiellement déjà exécuté). **Aucun des deux ne peut être rejoué automatiquement.** G7 autorise uniquement la clôture explicite, avec résultat préalablement vérifié hors du programme, preuve SHA-256 et identité d'opérateur.

- `observed-applied` : l'opérateur a constaté l'effet distant ; ne pas rejouer.
- `observed-not-applied` : l'opérateur a constaté que l'effet n'a pas eu lieu ; ne pas rejouer cet identifiant. Une **nouvelle** demande peut être créée sous un nouvel identifiant après clôture.

La résolution écrit une attestation HMAC dans le journal déjà signé : type de constat, empreinte SHA-256 de la preuve externe, empreinte de l'identifiant d'opérateur et horodatage UTC. Aucun contenu de preuve, message, réponse ou token n'est enregistré. La commande ne sait pas lire un site distant : **l'empreinte ne prouve pas, à elle seule, la validité du constat**. Une revue humaine authentique est impérative.

Le tour devient `reconciled`, irréversible par cette interface ; son identifiant reste dans le journal et ne peut plus servir à une soumission. Le journal a toujours une capacité limitée (16 entrées). Aucune purge n'est disponible dans G7 : cela évite de casser l'anti-rejeu.

## Utilisation opérateur (journal existant et arrêté uniquement)

Définir la clé secrète 256 bits du journal dans `WEBBRIDGE_RELAY_TOKEN`, au niveau du processus uniquement — **jamais dans la ligne de commande**. Exemples PowerShell :

```powershell
# Fournir WEBBRIDGE_RELAY_TOKEN par un coffre local approprié (non montré ici).
npm run journal:operator -- inspect --dir 'D:\Journal-WebBridge' --session s1 --provider qwen --tab t1 --account a1

# Après vérification indépendante du résultat réel :
npm run journal:operator -- resolve --dir 'D:\Journal-WebBridge' --session s1 --provider qwen --tab t1 --account a1 --turn turn1 --outcome observed-applied --evidence-sha256 '<64-caracteres-hex-sha256>' --operator op1 --ack I-VERIFIED-REMOTE-OUTCOME
```

Les noms d'identifiants sont ici **synthétiques**. Le programme exige le même propriétaire que celui du journal, un fichier existant, une clé valide, un identifiant d'opération incertain et une confirmation explicite. Sans ces éléments, aucune modification. L'option `inspect` est en lecture seule sur un journal existant, hormis la prise puis la libération du verrou d'accès exclusif.

**Après crash avec fichier `.lock` résiduel :** vérifier manuellement que le serveur et tout compagnon utilisant ce journal sont arrêtés ; conserver une sauvegarde du journal signé et une chaîne de preuve ; lever le verrou résiduel uniquement en suivant une procédure opérateur distincte, jamais automatiquement. La commande G7 **n'efface pas les verrous** et refuse d'ouvrir un journal possédé.

## Tests et limites

Tests de non-rejeu après réconciliation et redémarrage ; refus de clôture sans attestation, sans empreinte, sur tour déjà terminé/annulé, sur journal verrouillé et sur identité erronée ; absence de fuite du contenu d'origine. Les smokes G3–G6 (RPC, modèle natif, navigateur HTML Chromium isolé) doivent continuer à passer.

G7 ne résout pas la récupération d'une **réponse du navigateur** perdue : il clôt uniquement l'incertitude de l'effet, et toute réponse modèle devra être recalculée sans renvoyer le même effet. Aucun mécanisme « exactement une fois » n'est revendiqué. Avant production, ajouter contrôle indépendant des preuves, journaux d'audit centralisés, rétention réglementée, rotation des clés et séparation de fonctions.
