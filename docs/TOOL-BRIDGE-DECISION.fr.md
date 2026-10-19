# Décision — pont d'outils natif : PARQUÉ

**Statut : parqué. Désactivé par défaut. Non supporté.**

`toolBridge` reste une option **opt-in** (`WEBBRIDGE_NATIVE_TOOL_BRIDGE=1` ou
`toolBridge: true`). Tant qu'elle est inactive — c'est-à-dire par défaut — les modèles
WebBridge n'annoncent **aucune** capacité d'outil (`capabilities.tools: false`) et ne
peuvent donc pas prétendre pouvoir appeler quoi que ce soit.

## Ce qui a été tenté

Un tour réel, pont actif, sur un fournisseur dont l'onglet est sur une conversation
et dont l'envoi est prouvé (ChatGPT), avec une consigne explicite d'exécuter une
commande shell.

## Ce qui a été observé

| Observation | Preuve |
| --- | --- |
| Aucun événement `tool-call` produit | sortie brute du tour : `step_start` + `text`, jamais de partie d'outil |
| Le modèle **écrit de la prose** au lieu d'émettre le bloc ` ```webbridge-tool ` | le texte livré décrit une exécution qui n'a pas eu lieu |
| Les tentatives suivantes meurent avant conclusion | journal : `uncertain / send-uncertain` et `inflight` |

## Pourquoi ce n'est pas activable en l'état

Le pont demande à un **modèle de chat** d'**écrire** un appel d'outil sous forme de
texte encadré. C'est une surface fragile par construction :

1. le modèle n'émet pas le bloc de façon fiable ;
2. la règle **tout ou rien** du pont délivre alors le texte tel quel — ce qui est le
   comportement correct, mais laisse croire à l'utilisateur qu'une action a eu lieu ;
3. un appel d'outil annoncé et **silencieusement non exécuté** est pire qu'aucun appel.

Activer cette option sur la base d'un seul essai favorable serait exactement le genre
de revendication que ce projet s'interdit.

## Ce qui débloquerait réellement la fonctionnalité

Un **canal d'appel d'outils natif**, c'est-à-dire un connecteur MCP exposé au modèle,
plutôt qu'un format texte à respecter. C'est une **décision d'architecture**, pas un
correctif : elle implique un tunnel, une clé restreinte et un plan/workspace autorisant
les connecteurs — et elle est **spécifique à ChatGPT**, les quatre autres fournisseurs
n'ayant pas de mécanisme équivalent.

Tant que cette décision n'est pas prise, la voie texte reste **expérimentale et
non supportée**.

## Conséquence pratique

- L'option reste dans le code, documentée comme expérimentale.
- Elle n'est **jamais** activée par défaut, ni par la configuration livrée.
- Aucune documentation d'usage ne la présente comme fonctionnelle.
- Le cas d'usage réel de WebBridge — **discuter avec un fournisseur et ramener sa
  réponse en contexte** — ne dépend pas d'elle et fonctionne sans.
