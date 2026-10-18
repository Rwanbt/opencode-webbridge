# ADR 0126 — G173, sondage Qwen natif et frontière de modèle

Sur la lignée du véritable paquet installable G168/G172, G173 intègre G169 et G170 indépendamment : le vrai outil racine expose un `probe` Qwen borné à l'onglet, origine, document et permissions, mais n'exporte aucun texte Qwen non vérifié. L'outil conserve le statut `NO_GO_UNVERIFIED_LIVE_QWEN_DOM`. L'adaptateur ne lit un corps que dans une fixture HTTPS interceptée explicitement, jamais sur le site réel non vérifié.

Le module G170 est conservé comme preuve autonome de l'API publique `provider.transform` dans le CLI officiel, sans être chargé par le plugin root en mode utilisateur. Aucune réponse DOM G166 ne constitue encore une finalité d'inférence prouvée. Les modèles fournisseurs commerciaux restent donc non annoncés. Tests Linux réels Chromium et CLI isolé sont additifs; aucune attestation OS/Desktop ni interaction authentifiée ne découle de ces résultats.
