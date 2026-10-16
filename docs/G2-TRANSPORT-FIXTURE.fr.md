# G2 — Chaîne modèle OpenCode ↔ BrowserPort (fixture)

**Date : 17 octobre 2026 ; statut : fixture de transport validée, navigateur réel non connecté.**

## Preuve reproductible

```sh
npm ci
npm test
npm run smoke:browser
```

Le smoke lance un véritable OpenCode **2.0.29** depuis un profil temporaire sans compte, injecte un plugin natif **de test seulement**, puis échange avec un serveur HTTP strictement local. Cette fois, le serveur transmet la requête au `BrowserPort` typé, auquel une implémentation simulée répond. La réponse revient à OpenCode en suivant son transport de fournisseur habituel.

Chaîne démontrée : **OpenCode session native → fournisseur de test → HTTP loopback avec secret éphémère → extraction du dernier texte utilisateur → `BrowserPort.submit` → `BrowserPort.events` → réponse finalisée → SSE → OpenCode**.

## Protections déjà testées

- Authentification Bearer éphémère (256 bits) sur le port local ; refus `401` sans secret et pour les identifiants erronés.
- Serveur limité à `127.0.0.1`, port dynamique, chemin `/v1` strict. Aucun tunnel public, aucune connexion à une plateforme réelle.
- `BrowserPort` vérifie la propriété session / fournisseur / onglet / compte et refuse les doubles demandes portant le même `turnID`.
- La réception exige des événements ordonnés avec `turnID` correspondant ; aucune réponse tronquée, non terminée ou forgée n'est acceptée.
- La capture des entrées/sorties et les polls sont bornés. Aucun rejeu automatique en cas d'état incertain ; une réconciliation explicite est nécessaire.
- Activation explicite du plugin de fixture uniquement, sans modèle fictif affiché par le plugin de production.

## Limites restantes et blocages

1. Le navigateur est **simulé**, pas le navigateur intégré OpenCode, dont l'API directe n'est pas exposée dans le contexte public `@opencode/plugin@2.0.29`. L'utilisation des outils Code Mode par un agent n'établit pas une API disponible pour un fournisseur de modèles.
2. Une démonstration E2E sur une page de chat locale réelle, avec navigateur attaché et consentement, reste indispensable.
3. Le transport HTTP de ce lot est un *banc de test*, pas un serveur permanent durci. Il ne doit pas être exposé à un réseau, empaqueté comme produit ou activé avec de vraies sessions web.
4. Le `turnID` est généré pour chaque appel de modèle ; l'idempotence inter-processus, la réconciliation après crash et les appels d'outils avec effets OS restent à construire.
5. La revue indépendante des conditions des cinq sites doit aboutir avant toute automatisation réelle. Aucune extraction d'interface ou contournement de limitations n'est autorisé.

## Suite

Étudier un canal d'intégration **officiellement supporté** entre l'application de bureau et `BrowserPort` (RPC exposé à un module explicite et consenti, ou extension OpenCode nécessaire). Tant qu'il n'existe pas, ne pas afficher ChatGPT, DeepSeek, Gemini, Qwen ou Mistral comme des fournisseurs opérationnels.
