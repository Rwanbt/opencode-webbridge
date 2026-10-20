# Preuve live des cinq fournisseurs (2026-10-20)

> **Document de preuve, pas de décision de release.** La décision reste dans
> `docs/QUALIFICATION.fr.md` (générée depuis `planning/`). Ce qui est consigné ici
> est ce qui a été **mesuré**, avec les états bruts du journal.

## 1. Méthode

- Un **code unique par fournisseur**, jamais réutilisé : le texte du prompt est la
  clé de la tentative (`promptKey`), donc deux tours avec la même phrase ne peuvent
  pas être distingués et le second est refusé.
- Commande identique pour tous :
  `opencode run --standalone --model webbridge/<fournisseur>-web --format json "<prompt>"`.
- Preuve retenue : l'état **`complete / dom-completion-proven`** écrit dans le
  journal pour **ce** tour, avec la clé du message réellement lu.
- La réponse rendue par le CLI doit être **le code attendu**, pas seulement un
  texte quelconque.
- L'onglet déclaré doit être **visible** : mesuré sur Qwen et DeepSeek (voir §5),
  un onglet caché ne rend pas ce que le lecteur doit lire.

## 2. Matrice

| Fournisseur | Code attendu | Réponse rendue | Journal | Tour | Message lu |
| --- | --- | --- | --- | --- | --- |
| Gemini | `WB-GE-032025` | `WB-GE-032025` | `complete / dom-completion-proven` (03:20:40) | `59f0a7e1…` | `12b696aa35480822` |
| Mistral Le Chat | `WB-MI-032040` | `WB-MI-032040` | `complete / dom-completion-proven` (03:21:00) | `9986d0f3…` | `d116eb93-…` |
| Qwen | `WB-QW-032101` | `WB-QW-032101` | `complete / dom-completion-proven` (03:21:14) | `430e268a…` | `chat-response-message-eb898ef5-…` |
| DeepSeek | `WB-DE-032626` | `WB-DE-032626` | `complete / dom-completion-proven` (03:26:41) | `a6a24a97…` | `4573e92b-…:4` |
| ChatGPT | `WB-CH-032716` | *non envoyé* | **refus avant envoi**, voir §4 | — | dernier `complete` : 2026-10-19 18:08:55, tour `ff720082` |

**Quatre preuves sur cinq sont datées de ce jour et de ce dépôt.** ChatGPT est
bloqué par une donnée qui n'appartient pas au plugin, pas par un défaut du
transport : le compositeur de l'onglet déclaré contient **6 502 caractères d'un
texte étranger** (un catalogue système), et le plugin refuse — correctement — de
remplacer un brouillon non vide :

```text
G159 send refused: nonempty user draft cannot be replaced
```

Ce refus est le comportement attendu : écraser silencieusement le texte de
l'opérateur serait une faute plus grave que de ne pas envoyer. Le dernier
`complete` enregistré **sur cet onglet** reste valable (même onglet `852701…`,
tour `ff720082`, `dom-completion-proven`). Une tentative dans un onglet neuf a
été faite puis annulée : le nouvel onglet ne rendait jamais son compositeur, et la
carte `tabs` a été restaurée à l'identique.

## 3. Preuves brutes

```json
{"turnID":"59f0a7e1a14d516c2b0b74d6747c02b3","state":"complete","at":1792459240104,"reason":"dom-completion-proven","messageKey":"12b696aa35480822","progress":{"seq":1,"length":12,"hash":"34ea1bcf…"},"scope":{"tabID":"695ECF4C1C92F71DCC9DCDD3A1DC4AB4","generation":2}}
{"turnID":"9986d0f394468233115755caf9678a28","state":"complete","at":1792459260789,"reason":"dom-completion-proven","messageKey":"d116eb93-58ef-49c5-bfe1-22d77ea4a0dd","progress":{"seq":1,"length":12,"hash":"25869101…"},"scope":{"tabID":"75C500C846B5B35CF571F4E87DC7A2A8","generation":4}}
{"turnID":"430e268a9247348a9e1009e454d2ad48","state":"complete","at":1792459274643,"reason":"dom-completion-proven","messageKey":"chat-response-message-eb898ef5-a698-48ef-9b28-f9b2854fc75a","progress":{"seq":1,"length":12,"hash":"e00d6f03…"},"scope":{"tabID":"CDAE9EAD0F7B8C605234FB9D81129236","generation":1}}
{"turnID":"a6a24a976dd74f384b6a764c3d6bbc23","state":"complete","at":1792459601499,"reason":"dom-completion-proven","messageKey":"4573e92b-3354-4b5f-99a3-81eca0618840:4","progress":{"seq":1,"length":12,"hash":"39627a40…"},"scope":{"tabID":"D371BE975C9604B95F28BF0312C91F01","generation":1}}
```

Les journaux complets sont dans `C:\Users\barat\.webbridge\journal` (fichiers
`attempt-*.json`), horodatés : `03:20:40`, `03:21:00`, `03:21:14`, `03:26:41`.

## 4. Ce que cette preuve ne dit pas

- **Un tour par fournisseur n'est pas un usage réel.** Un échange prouve le
  transport, la lecture et la finalité ; il ne prouve ni les conversations
  longues, ni les changements de sujet, ni les réponses coupées en cours de
  génération.
- **Rien sur Desktop/Electron.** Aucune preuve de ce niveau n'existe.
- **Aucune écriture navigateur** n'est revendiquée.
- **ChatGPT n'a pas été rejoué aujourd'hui** pour la raison du §2 : la preuve
  citée date du 2026-10-19.

## 5. Deux défauts trouvés *par* cette preuve, et corrigés

1. **Clic souris forcé sans effet** (Qwen `g176`, DeepSeek `g174`). Le clic
   retournait sans erreur, le compositeur gardait le prompt et le tour finissait
   `no-new-candidate`. Un **clic DOM** sur le même contrôle a envoyé immédiatement
   (Qwen : 5 → 6 réponses ; DeepSeek : compositeur vidé, tour créé). Le code
   confirme désormais l'effet observable (compositeur vidé) et retire **notre**
   copie intacte quand rien n'a été envoyé — sans jamais écraser un brouillon
   modifié par l'opérateur.
2. **Onglet caché = rien à lire** (Qwen et DeepSeek). Qwen peint le texte mais ne
   monte sa barre d'actions que sur un onglet visible (0 bouton pendant 71 s, ni
   survol ni défilement). DeepSeek peint une **liste virtuelle vide** alors que la
   conversation existe côté serveur (0 élément pendant 32 s). L'activation de
   l'onglet a rendu, en trois secondes, les sept contrôles de Qwen et les deux
   tours de DeepSeek. L'observateur active donc l'onglet déclaré avant de lire,
   pour tous les fournisseurs.
