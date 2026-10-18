# Observateur manuel WebBridge (`webbridge-manual-observe`)

Opérateur **lecture seule** par fournisseur : il attache un onglet CDP déjà
ouvert et déjà sélectionné, découvre le dernier message assistant, le fait
confirmer par l'opérateur, puis lit sa progression bornée. Il **n'envoie
jamais rien**, ne prétend jamais qu'une réponse est terminée, et refuse toute
exécution non interactive (pipe, tâche de fond).

## Ce que la commande prouve (et ne prouve pas)

- Prouve : l'onglet déclaré existe, son origine et sa génération sont vérifiées,
  le lecteur du fournisseur fonctionne sur l'interface réelle, la lecture est
  bornée et révocable (chaque lecture relit le drapeau d'autorisation), le
  terminal reste honnête.
- Ne prouve pas : l'existence d'une réponse à un prompt envoyé (la corrélation
  reste `unverified-dom`), la finalité côté fournisseur, ni la moindre
  capacité d'envoi. Une observation réussie se termine toujours
  `TERMINAL UNCERTAIN` (ou `NO-GO` pour Qwen).

## Modèle de consentement

1. `YES` — je possède/contrôle la session Chromium CDP et l'onglet sélectionné.
2. `YES` — j'autorise la lecture du texte assistant (lecture seule).
3. Si `--message` est absent : découverte d'un message, affichage de sa clé et
   d'un aperçu `[UNVERIFIED]`, puis `YES` — j'observe exactement ce message.

La révocation est immédiate : retirer l'onglet (le fermer, le remplacer ou le
naviguer) ou interrompre (`Ctrl+C`) ; chaque lecture revérifie l'autorisation.

## Utilisation

```sh
# Découverte + confirmation + observation du dernier message assistant :
node bin/webbridge-manual-observe.mjs \
  --provider deepseek --endpoint http://127.0.0.1:9222 --tab <CDP_TARGET_ID> --turn <TURN_ID>

# Observation directe d'un message déjà connu (clé relevée dans DevTools) :
node bin/webbridge-manual-observe.mjs \
  --provider chatgpt --endpoint http://127.0.0.1:9222 --tab <CDP_TARGET_ID> --turn <TURN_ID> \
  --message <MESSAGE_KEY> --polls 12

# Qwen : la sonde de disponibilité vérifie l'onglet puis termine NO-GO
# (le DOM Qwen réel n'est pas vérifié ; aucune lecture n'est faite) :
node bin/webbridge-manual-observe.mjs \
  --provider qwen --endpoint http://127.0.0.1:9222 --tab <CDP_TARGET_ID> --turn <TURN_ID> --message probe
```

`--polls` borné à `1..32` (défaut 12, ~200 ms d'intervalle). L'endpoint doit
être strictement `http://127.0.0.1:<port>/` ; tout le reste refuse.

## État réel par fournisseur (registre `src/providers/provider-adapters.ts`)

| Fournisseur | Lecture | Découverte | Envoi | Terminal |
| --- | --- | --- | --- | --- |
| ChatGPT | g157 (observateur réel) | oui | g159 (commande distincte, un envoi manuel) | UNCERTAIN |
| DeepSeek | g160 (sélecteurs tâtonnants) | oui | aucun | UNCERTAIN |
| Gemini | g160 (sélecteurs tâtonnants) | oui | aucun | UNCERTAIN |
| Mistral Le Chat | g160 (sélecteurs tâtonnants) | oui | aucun | UNCERTAIN |
| Qwen | g169 (sonde seule, NO_GO live) | non | aucun | NO-GO |

Aucun fournisseur ne peut actuellement **prouver** l'achèvement DOM : le
terminal reste `uncertain` par construction. Aucune capacité d'envoi n'est
inventée pour les fournisseurs sans primitive vérifiée ; le transport natif
refuse tour par tour (dégradation par fournisseur, jamais un veto global).

## Rapport avec le transport natif

L'observateur est l'outil de préparation manuelle de la vérification par
fournisseur exigée par le plan (sélecteurs réels, sémantique d'onglet). Le
transport natif (`WEBBRIDGE_NATIVE_TAB_<PROVIDER>`) partage exactement les
mêmes lecteurs ; l'observateur ne crée aucun état, n'écrit aucun journal et
n'expose aucun canal de modèle.
