# ADR 0024 — Instantané de revue des sources par service

**Instantané daté du 17 octobre 2026, non substitut à un avis juridique.** `planning/provider-policy-review.json` conserve les sources en rapport avec les interfaces web des cinq services ; il ne concerne ni leurs API officielles ni les modèles locaux. Les cinq transporteurs web n'ont pas encore été validés en situation réelle.

| Fournisseur | Source officielle | Décision conservatrice |
| --- | --- | --- |
| ChatGPT | https://openai.com/fr-FR/policies/eu-terms-of-use/ (mise à jour janvier 2026, EEE) | Les conditions encadrent notamment l'extraction automatique de données/sorties. |
| DeepSeek | https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html (27 mars 2026, section 3.5) | Restrictions propres au service sur certains mécanismes de capture automatisée. |
| Gemini | https://policies.google.com/terms?hl=fr | Revoir également les conditions spécifiques Gemini et les mécanismes techniques applicables. |
| Qwen | https://qwen.ai/termsservice (version publique consultée octobre 2026) | Les conditions distinguent notamment les interactions et l'extraction automatisées. |
| Mistral Le Chat | https://mistral.ai/static/doc/fr-conditions-generales-20250206.pdf et https://legal.mistral.ai/terms/eu-consumers-terms-of-service/ | Revoir les modalités applicables à l'usage de Le Chat avec un logiciel tiers dans la version EEE la plus récente. |

Le validateur `check:policy` assure désormais l'intégrité d'une **décision individuelle par fournisseur** et de sa source, sans déduire qu'une connexion fonctionne. Les contrôles de session utilisateur, de transport, de capacités vérifiées et de permissions d'outil restent indépendants. Aucun navigateur réel, CAPTCHA, cookie, token ou identifiant de compte n'a été employé pour cet instantané documentaire.

**NO-GO** : 0/5 interfaces web effectivement opérationnelles, aucune acceptation production ; les correctifs natifs Core↔Desktop ne prouvent pas l'atomicité et les écritures WebBridge restent désactivées. L'activation fonctionnelle devra être constatée fournisseur par fournisseur.
