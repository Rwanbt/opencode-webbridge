# G25 — Convergence du relais témoin et de la supervision Windows

Cette branche importe **sans réécriture** les deux commits existants de la PR Draft #85 (`cbbacde`, `403c058`) au-dessus de la PR de convergence #99. Les changements d'isolation des processus, de fermeture contrôlée des enfants, des probes **lecture seule** de disponibilité du CLI OpenCode 2.0.29, et du `take` de relais encore vide sont repris. Les actions `run`, `submit` et `complete` ne sont jamais automatiquement répétées après un délai incertain.

Le script `smoke-model-rpc-e2e.mjs` conserve l'activation du témoin externe G20. Le banc forme ainsi une chaîne isolée : OpenCode 2.0.29 natif → modèle fictif → RPC authentifié → compagnon local ou page Chromium → journal HMAC v2/témoin → réponse progressive. **Ce n'est pas une intégration du navigateur Desktop officiel** ni un fournisseur web commercial.

Avant convergence, #92 a eu un timeout local Windows de 45 secondes sur l'ancien lanceur ; cela ne doit pas être oublié même si les CI séparées étaient vertes. La nouvelle branche exige les tests de fermeture, de probe et de journal, ainsi que des smokes Linux/Windows sur son SHA exact ; aucune sortie « PASS » ne doit être affichée avant la fermeture contrôlée et la vérification des effets. L'historique d'intermittence peut subsister et reste à surveiller.
