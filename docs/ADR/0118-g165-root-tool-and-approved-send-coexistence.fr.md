# ADR 0118 — G165, cohabitation du plugin racine et de l'envoi explicitement approuvé

## Décision

Réunir, sur une branche isolée partant de G163 #242 (`e8c896e`), les fichiers vérifiés de G162 #241 (`84cf808`) sans modifier les fichiers propres au plugin racine G163. Préserver la réparation G158 du tour Git, le journal à consommation unique et l'envoi CDP G159. Vérifier ensemble les tests de G158, G159 et G163, et les ajouter de façon additive à la CI Linux existante.

## Frontière

Le plugin officiel expose encore uniquement un outil de lecture navigateur conditionnel, pas un modèle d'inférence ChatGPT ni un envoi via cet outil. Le code G159 demeure une capacité séparée soumise à l'approbation explicite de l'utilisateur; il ne doit jamais être déclenché automatiquement par le modèle. Le journal G159 peut produire un état incertain et refuse le rejeu aveugle. La fixture Chromium HTTPS ne prouve aucune session authentifiée réelle; le SDK public ne prouve pas l'identité d'un principal OS/Desktop.

Cette intégration ne change aucune installation officielle, ne fusionne aucune PR et ne prouve ni production, ni Electron E2E, ni fournisseur opérationnel. Les écritures WebBridge restent désactivées dans la release.
