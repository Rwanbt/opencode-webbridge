# G4 — Modèle natif OpenCode → RPC → compagnon fictif → modèle natif

**17 octobre 2026 — preuve de bout en bout entièrement locale, sans navigateur web réel.**

## Test et résultat

```sh
npm run smoke:e2e
```

Le script crée un profil OpenCode jetable, enregistre deux **plugins de test** (fournisseur de modèle et relais RPC), démarre un serveur OpenCode **2.0.29**, puis exécute une vraie session native sur un modèle explicitement fictif. Le fournisseur utilise un point d'inférence HTTP sur `127.0.0.1`, protégé par un jeton éphémère. La génération emprunte ensuite l'interface `BrowserPort` et des appels RPC OpenCode `submit`/`result`. Un compagnon synthétique reçoit le travail une seule fois via `take`, transmet `complete`, puis la réponse revient dans la session OpenCode.

Résultat observé sur Windows : `PASS`, 3 requêtes HTTP de modèle, 2 tâches traitées par le compagnon et une réponse finale reconnue. **Ces compteurs ne démontrent pas une sémantique exactement une fois côté requêtes de modèle.** La garantie de non-redélivrance du relais ne porte que sur chaque `turnID` déjà pris en charge ; le modèle peut créer plusieurs tours distincts.

## Contrôles

- Connexions exclusivement locales ; port temporaire, mot de passe de serveur et jeton RPC **distincts** ; secret d'inférence lui aussi distinct.
- Variables d'environnement enfant limitées à une liste minimale. Aucune clé API, authentification web, cookie ou historique utilisateur n'est récupéré.
- Identités de tests fixes et synthétiques (`fixture-session`, `fixture-tab`, `fixture-account`), sans autorité sur le véritable navigateur de l'utilisateur.
- Abandon sur dépassement du temps maximal, fermeture des processus et effacement du répertoire temporaire.
- Aucun enregistrement de fournisseur web réel dans le plugin de production, qui reste inerte.

## Risques et prérequis restants

La chaîne démontre **l'orchestration complète**, mais pas la commande du navigateur intégré OpenCode. Son SDK public ne donne pas de pilote navigateur à `ctx.rpc` ou `ctx.provider` ; un composant Desktop/TUI capable de manipuler des onglets de façon documentée et autorisée reste nécessaire. Une API RPC est un moyen de transmettre des tâches, **pas** une permission d'agir dans les pages.

Le relais est en mémoire, le propriétaire est synthétique et il manque le pairage/consentement utilisateur, la réconciliation persistante après crash, les commandes d'annulation distante et l'exécution contrôlée d'outils. Les fournisseurs ChatGPT, Gemini, DeepSeek, Qwen et Mistral restent désactivés en attente d'évaluation de leurs politiques et d'essais E2E explicitement autorisés.

## Étape suivante

Étudier un module client Desktop/TUI basé sur les points d'extension réellement supportés, capable de se connecter au relais RPC et de **contrôler une page locale de démonstration**, avec consentement et vérification de l'origine. Ne pas relier de comptes commerciaux avant les gates de sécurité et de conformité.
