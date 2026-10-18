# ADR 0093 — Quotas finis et leases de concurrence irrévocables par reset (G142)

**Statut : durcissement E4/E7 en mémoire, NO-GO production.**
Branche isolée basée sur G136 #213. Aucune modification du produit OpenCode
installé, des fournisseurs E5 ou des worktrees des autres agents.

## Quatre comportements RED reproduits

1. `maxConcurrency=NaN` ou `Infinity` contournait la comparaison et autorisait
   une concurrence potentiellement illimitée ; mêmes validations incomplètes
   pour `maxPerWindow` et `windowMs`.
2. `reset()` avec une opération active remettait le compteur à zéro. Une
   libération tardive de l'ancien lease pouvait même diminuer le compteur
   d'une nouvelle opération et permettre des dépassements.
3. Une horloge fournie par l'appelant qui recule pouvait rester acceptée
   et rendre les compteurs ambigus.
4. Les noms de clé arbitraires et la croissance illimitée du registre des
   clés permettaient confusion de sessions et pression mémoire.
   Le config initial était conservé par référence et modifiable.

## Mesures GREEN

Validation d'un objet de configuration exact, composé uniquement de données
propres, sans getters et avec entiers sûrs finis ; copie gelée. Plafonds
explicites : 1000 opérations par fenêtre, fenêtre 1 jour, concurrence 256,
1024 clés de quota mémorisées. Les clés doivent être des identifiants opaques.
`reset` refuse catégoriquement toute opération en cours. Une horloge
régressive refuse l'acquisition. Une nouvelle clé au-delà de la capacité est
refusée, sauf si les anciennes fenêtres ont réellement expiré.

Tests RED→GREEN : valeurs non finies, config mutable, reset pendant un lease,
horloge régressive et flood de plus de 1024 clés. Les parcours standards
et libérations idempotentes restent verts.

## Frontières de confiance

La clé de quota et le temps doivent venir du **host authentifié**, pas du
modèle, du DOM ou d'un worker non fiable. Ce module n'est qu'une limite en
mémoire mono-processus, sans synchronisation durable entre processus ni
protection contre la déconnexion/reconnexion vers une autre instance ;
il ne prouve pas un budget global commercial. Les introspections de
`Proxy` JavaScript arbitraires ne sont pas isolées ; parser avant validation.

Aucune autorisation native ou commerciale nouvelle :
fournisseurs 0/5, 0/54 stories production, browser writes OFF.
