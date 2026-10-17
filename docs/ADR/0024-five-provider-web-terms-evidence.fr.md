# ADR 0024 — Sources officielles des restrictions web et activation désactivée

**Examen daté du 17 octobre 2026, non substitut à un avis juridique.** `planning/provider-policy-review.json` consigne les sources et décisions en rapport avec l'usage automatisé des *sites de chat grand public*; il ne concerne ni les API officielles ni les poids de modèles exécutés localement. Les cinq transporteurs commerciaux restent désactivés.

| Fournisseur | Source officielle | Décision conservatrice |
| --- | --- | --- |
| ChatGPT | https://openai.com/fr-FR/policies/eu-terms-of-use/ (mise à jour janvier 2026, EEE) | Les conditions interdisent l'extraction automatique ou programmatique de données/sorties. **Aucune autorisation de WebBridge établie**. |
| DeepSeek | https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html (27 mars 2026, section 3.5) | Restrictions sur la capture/copie par robots, spiders ou dispositifs automatisés. **Aucune exemption WebBridge vérifiée**. |
| Gemini | https://policies.google.com/terms?hl=fr | Google encadre l'accès automatisé par les instructions de ses pages; **aucun droit précis pour ce relais de chat web établi**. À réexaminer avec les conditions spécifiques de Gemini et robots applicables. |
| Qwen | https://qwen.ai/termsservice (version publique consultée octobre 2026) | Restrictions explicites sur l'interaction/extraction automatisée et le scraping. **Accès automatisé WebBridge non autorisé par nos preuves**. |
| Mistral Le Chat | https://mistral.ai/static/doc/fr-conditions-generales-20250206.pdf (conditions Le Chat 6 février 2025) et https://legal.mistral.ai/terms/eu-consumers-terms-of-service/ | Les conditions particulières de Le Chat nécessitent une autorisation écrite préalable pour intégration avec un autre logiciel. Revalider la version EEE la plus récente avant toute décision. |

Le validateur `check:policy` refuse une activation globale, un fournisseur `approved: true`, une décision `permitted` non étayée ou une source non officielle. Une révision conforme doit enregistrer une autorisation applicable au scénario exact (compte, finalité, automatisation, région et date) et passer une revue humaine **avant** d'activer le moindre site. Le simple abonnement utilisateur ne constitue pas cette autorisation. Aucun navigateur réel, CAPTCHA, cookie, token ou identifiant de compte n'a été employé pour cette revue. Elle repose uniquement sur la documentation publique.

**NO-GO** : 0/5 fournisseurs commerciaux opérationnels, aucune acceptation production; les correctifs natifs Core↔Desktop ne prouvent pas l'atomicité et toutes les écritures WebBridge restent interdites. Les tests de fixtures et le code de contrat commun continuent indépendamment des interdictions contractuelles.
