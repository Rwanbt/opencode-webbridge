# Sous-agents et WebBridge — évaluation réelle (T03)

Ce document évalue ce que l'**API publique** d'OpenCode 2.0 permet réellement pour
l'utilisation de WebBridge par des sous-agents, ce que le plugin fait en conséquence, et
ce qui **n'est pas disponible** (aucune compatibilité n'est inventée).

## Ce qui est prouvé (L1, tests exécutables)

| Capacité | Comportement réel | Preuve |
| --- | --- | --- |
| Héritage contrôlé des permissions | chaque appel d'outil demande l'autorisation **avec l'identité de l'agent invocateur** ; le cœur décide, le plugin ne décide pas | `test/subagent-isolation.test.ts` (l'agent 2 refusé ne reçoit rien) |
| Aucune élévation implicite | une invocation dont `sessionID`/`agent`/`messageID`/`id` n'est pas vérifiable est **refusée avant toute autorisation** | idem (4 formes invalides, 0 autorisation demandée) |
| Aucun cache de permission | chaque appel redemande l'autorisation **avant et après** la lecture (une révocation pendant l'attente annule la sortie) | `test/readonly-tools.test.ts` + `test/subagent-isolation.test.ts` (4 demandes pour 2 appels) |
| Isolation des sessions/contextes | aucune autorisation n'est partagée : le scope opaque lie chaque proposition à la session/tour/appel, et une proposition d'une autre session est refusée par le validateur | `test/readonly-tools.test.ts` (`scope-mismatch`) |
| Annulation d'une branche | `invocation.signal` interrompt avant toute demande, et le processus `git` est tué sur annulation ; aucun effet partiel | `test/subagent-isolation.test.ts`, `src/core/readonly-read.ts` |
| Budgets | bornes fixes par appel : 16 Kio de sortie, 4 s, énumération Git bornée (`--max-count<=10`), aucune écriture possible | `test/readonly-tools.test.ts` |
| Anti-fuite | refus de toute sortie ressemblant à un secret (DLP) et de `.git` interne ; le journal natif ne stocke jamais le texte assistant | `test/readonly-tools.test.ts`, `test/native-durable-progress.test.ts` |

## Ce qui n'est PAS disponible via l'API publique (documenté, non contourné)

1. **Le plugin ne peut pas énumérer les agents ni leurs permissions.** Il n'existe pas d'API
   publique pour lire la liste des sous-agents, leurs budgets ou leur arbre d'exécution :
   WebBridge ne peut donc pas appliquer une politique *par agent*. Il applique une politique
   *par appel*, en déléguant la décision au cœur (qui, lui, connaît l'agent).
2. **Aucun budget par agent ni par arbre.** Les bornes appliquées sont par appel
   (taille/temps) et par fournisseur pour l'inférence (budget de tours, `governance-*`).
   Il n'existe pas de point d'accroche public pour un quota « par sous-agent ».
3. **Le hook modèle `ctx.aisdk.hook('language')` ne reçoit pas de `sessionID`** (limite
   déjà documentée dans `docs/proposals/plugin-provided-language-model.fr.md`, PR #260) :
   la permission native « par tour » du cœur n'est pas atteignable depuis un modèle
   WebBridge. C'est pourquoi la permission par action existe sur les **outils** (où
   l'identité est disponible) et pas sur l'inférence.
4. **Risque résiduel d'anti-rejeu partagé (documenté).** La clé d'anti-rejeu du transport
   natif est `(providerID, modelID, prompt)` : deux sessions (ou deux sous-agents) qui
   envoient **exactement** le même prompt au même fournisseur partagent la même tentative
   durable et la même tour navigateur. Ce n'est pas une confusion d'identité — le texte
   reste attribué `unverified-dom` et aucune permission n'est héritée — mais c'est une
   collision d'anti-rejeu, à corriger si le SDK expose un jour une identité de session au
   hook modèle.

## Conclusion

L'usage de WebBridge par des sous-agents est **supporté au niveau des outils** (permission
par appel portée par l'agent invocateur, révocation en attente, annulation, budgets fixes,
confinement du workspace), et **explicitement limité** sur trois points que le SDK public
ne permet pas : politique par agent, quotas par sous-agent, et identité de session dans le
hook modèle. Ces limites sont mesurées (tests) ou isolées (proposition upstream), jamais
présentées comme des fonctionnalités.
