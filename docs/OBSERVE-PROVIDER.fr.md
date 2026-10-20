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

# Qwen : lecture d'une réponse réelle (lecteur vérifié sur l'interface réelle ;
# le terminal reste UNCERTAIN par construction, voir plus bas) :
node bin/webbridge-manual-observe.mjs \
  --provider qwen --endpoint http://127.0.0.1:9222 --tab <CDP_TARGET_ID> --turn <TURN_ID> \
  --message <MESSAGE_KEY>
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
| Qwen | g160 (lecteur réel vérifié : `chat-response-message-<uuid>` + `.qwen-markdown`) | oui | aucun | UNCERTAIN (construction de la commande) |

Aucun fournisseur ne peut actuellement **prouver** l'achèvement DOM **depuis
cette commande** : elle est en lecture seule et n'émet jamais `complete`. La
finalité est en revanche mesurée côté transport, sur l'interface réelle :

- Gemini : `complete / dom-completion-proven` (journal, 2026-10-20).
- Qwen : la barre d'actions (`Copier`, `Bonne réponse`, `Partager`,
  `Régénérer`, `Plus d'actions`) **n'est montée que si l'onglet est visible**.
  Onglet caché : texte peint, zéro bouton pendant 71 s, ni survol ni défilement
  n'y changent rien. Onglet activé : les sept contrôles apparaissent en trois
  secondes. C'est pourquoi l'observateur active l'onglet déclaré avant de lire.

Aucune capacité d'envoi n'est inventée pour les fournisseurs sans primitive
vérifiée ; le transport natif refuse tour par tour (dégradation par fournisseur,
jamais un veto global).

## Rapport avec le transport natif

L'observateur est l'outil de préparation manuelle de la vérification par
fournisseur exigée par le plan (sélecteurs réels, sémantique d'onglet). Le
transport natif (`WEBBRIDGE_NATIVE_TAB_<PROVIDER>`) partage exactement les
mêmes lecteurs ; l'observateur ne crée aucun état, n'écrit aucun journal et
n'expose aucun canal de modèle.
