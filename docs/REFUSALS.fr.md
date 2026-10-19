# Catalogue des refus (chemin natif WebBridge)

Tout refus du chemin natif est **explicite**, **sans repli silencieux** et **sans succès
implicite**. Ce document est vérifié par un test : chaque marqueur listé ci-dessous doit
exister littéralement dans le code (`test/refusals-doc.test.ts`). Un marqueur absent du
code, ou retiré du code sans mise à jour de ce document, fait échouer la suite.

## 1. Déclaration d'onglet et journal (configuration)

| Marqueur | Où | Sens | Action opérateur |
| --- | --- | --- | --- |
| `"<http://127.0.0.1:port>#<tabID>"` | `src/native/consented-transport.ts` | la variable `WEBBRIDGE_NATIVE_TAB_<PROVIDER>` n'a pas la forme stricte `endpoint#tabID` | corriger la déclaration |
| `endpoint is not a valid URL` | `src/native/consented-transport.ts` | la partie avant `#` n'est pas une URL analysable | corriger l'endpoint |
| `must be an explicit loopback` | `src/native/consented-transport.ts` | l'endpoint n'est pas `http://127.0.0.1:<port>/` nu (schéma, hôte, port, chemin, query, **ou identifiants dans l'URL**) | n'utiliser que l'endpoint de débogage local, sans authentification |
| `tab id is not a CDP target id` | `src/native/consented-transport.ts` | la partie après `#` n'est pas un identifiant de cible CDP | recopier l'id exact de la cible |
| `(private directory)` | `src/native/consented-transport.ts` | un onglet est déclaré sans répertoire de journal privé (`WEBBRIDGE_NATIVE_JOURNAL_DIR` requis) | créer un répertoire privé et le déclarer |
| `directory required` | `src/native/attempt-store.ts` | le répertoire de journal est vide ou absent de l'environnement | déclarer `WEBBRIDGE_NATIVE_JOURNAL_DIR` |
| `directory missing` | `src/native/attempt-store.ts` | le répertoire déclaré n'existe pas | le créer (`mkdir -m 700`) |
| `private operator-owned directory required` | `src/native/attempt-store.ts` | le répertoire est partagé, symbolique, lisible par d'autres ou appartient à un autre utilisateur | corriger les permissions/propriété |
| `invalid attempt key` | `src/native/attempt-store.ts` | une clé de tentative n'a pas la forme attendue | ne pas fabriquer de nom de fichier |
| `corrupt attempt record` | `src/native/attempt-store.ts` | un enregistrement de journal est illisible, mal nommé ou incohérent | supprimer **manuellement** le fichier fautif en connaissance de cause |

## 2. Autorisation et envoi (consentement)

| Marqueur | Où | Sens | Action opérateur |
| --- | --- | --- | --- |
| `has no consented send primitive yet` | `src/native/consented-transport.ts` | l'onglet est déclaré mais le registre des adaptateurs ne déclare aucune primitive d'envoi pour ce fournisseur | aucun envoi n'est possible : attendre une primitive revue (jamais inventée) |
| `no consented send primitive for this provider` | `src/native/consented-cdp-attachment.ts` | seule l'attache ChatGPT est câblée aujourd'hui | idem |
| `no attached authorized browser session` | `src/native/consented-cdp-attachment.ts` | endpoint injoignable, onglet disparu ou origine non conforme | vérifier Chromium, l'onglet et `127.0.0.1:<port>` |
| `consent withdrawn` | `src/native/consented-cdp-attachment.ts` | la déclaration a changé depuis l'autorisation (révocation) | re-déclarer explicitement l'onglet |

## 3. Tour navigateur (bornes, portée, texte)

| Marqueur | Où | Sens | Action opérateur |
| --- | --- | --- | --- |
| `empty prompt refused` | `src/native/browser-turn-transport.ts` | prompt vide | corriger la demande |
| `above the reviewed bound` | `src/native/browser-turn-transport.ts` | prompt au-delà de `MAX_PROMPT_CHARS` (16 000, borne unique partagée avec les cinq primitives d'envoi) ; le message porte la longueur réelle observée | raccourcir le prompt ou le contexte injecté |
| `invalid bounded budget` | `src/native/browser-turn-transport.ts` | budgets `polls`/`intervalMs`/`reconcileWindowMs` hors bornes | corriger la configuration |
| `invalid attached tab identity` | `src/native/browser-turn-transport.ts` | l'onglet attaché ne fournit pas `{tabID, generation}` valides | ne pas contourner : ré-attacher proprement |
| `governance-` | `src/native/governed-transport.ts` | budget de tours épuisé ou tour déjà en cours (refus explicite, aucun effet navigateur) | attendre la fenêtre ou réduire la cadence |

## 4. Terminaux honnêtes (jamais une complétion inventée)

| Marqueur | Où | Sens |
| --- | --- | --- |
| `provider-finality-unverified` | `src/native/browser-turn-transport.ts` | texte observé, finalité fournisseur **non prouvée** : terminal `uncertain` |
| `no-new-candidate` | `src/native/browser-turn-transport.ts` | aucune réponse nouvelle n'a été observée |
| `candidate-replaced-or-rewritten` | `src/native/browser-turn-transport.ts` | le message sélectionné a changé ou été réécrit |
| `candidate-rewritten` | `src/native/browser-turn-transport.ts` | le texte n'est plus un simple ajout (préfixe rompu) |
| `checkpoint-mismatch` | `src/native/browser-turn-transport.ts` | le préfixe acquitté ne correspond plus au texte observé |
| `scope-changed` | `src/native/browser-turn-transport.ts` | autre onglet ou génération remplacée : aucune lecture adoptée |
| `read-revoked-or-document-changed` | `src/native/browser-turn-transport.ts` | lecture révoquée ou document remplacé pendant l'attente |
| `reconciled-attempt-without-observation` | `src/native/browser-turn-transport.ts` | tentative reprise sans observation enregistrée : aucun devinage |
| `send-uncertain` | `src/native/browser-turn-transport.ts` | l'effet du clic est inconnu : **jamais rejoué** |
| `cancelled-before-terminal` | `src/native/browser-turn-transport.ts` | annulation demandée avant tout terminal |
| `dom-completion-proven` | `src/native/browser-turn-transport.ts` | seule voie vers `complete` : une preuve injectée et vérifiée |
| `webbridge-terminal-uncertain` | `src/native/web-model.ts` | marqueur brut du terminal non prouvé côté session OpenCode |
| `webbridge-turn-cancelled` | `src/native/web-model.ts` | marqueur brut d'annulation |
| `webbridge-dom-completion-observed` | `src/native/web-model.ts` | marqueur brut de la seule complétion prouvée |

## 5. Opérateur de journal

| Marqueur | Où | Sens |
| --- | --- | --- |
| `WebBridge journal refusal` | `src/native/journal-operator.ts` | préfixe de tout refus de l'opérateur de journal |
| `unknown or duplicate argument` | `src/native/journal-operator.ts` | argument inconnu ou répété : aucun effet |
| `requires an explicit value` | `src/native/journal-operator.ts` | `--abandon`/`--journal` sans valeur : jamais un joker |
| `ambiguous target` | `src/native/journal-operator.ts` | plusieurs enregistrements partagent le préfixe |
| `unknown target` | `src/native/journal-operator.ts` | aucune tentative ne correspond |
| `several records` | `src/native/journal-operator.ts` | plusieurs enregistrements portent le même `turnID` |

## Principes non négociables (vérifiés par les tests)

- **Aucun repli silencieux** : un refus est toujours une erreur ou un terminal explicite.
- **Le DOM est une donnée non fiable** : le texte lu est attribué `unverified-dom`, jamais
  interprété comme une instruction ; aucune finalité n'en est déduite.
- **L'authentification HTTP Basic n'est jamais une identité** : toute URL d'endpoint
  contenant des identifiants est refusée (`explicit loopback debug endpoint`).
- **Fail-closed sans veto artificiel** : la dégradation est par fournisseur (onglet déclaré
  sans primitive d'envoi = refus au tour, plugin intact), jamais un blocage global.
- **Limite upstream isolée** : le hook `ctx.aisdk.hook('language')` ne reçoit pas de
  `sessionID` ; la permission native « par tour » du cœur n'est donc pas atteignable via
  l'API publique. Proposition isolée : `docs/proposals/plugin-provided-language-model.fr.md`
  (PR #260). Aucun patch du cœur distribué.
