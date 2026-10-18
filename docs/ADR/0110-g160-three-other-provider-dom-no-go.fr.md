# ADR 0110 — G160 : lecture DOM spécifique DeepSeek, Gemini et Mistral

**Statut : code exécutable à preuve Linux CI ; pas de compte réel vérifié.**

G160 est une branche isolée sur le HEAD G157 #236. Un lecteur DOM borné
(`G160OtherProviderObserver`) connecte un onglet Chromium existant et **choisi**
par son ID de cible CDP. La découverte et le contrôle des cinq origines HTTPS
sont issus de G155. Chaque lecture nécessite une permission séparée, révocable
et contrôlée avant et après l'attente. Seul un lecteur de DOM constant, lié
au fournisseur explicite, est exécuté ; jamais du JavaScript fourni par le
modèle, jamais d'envoi de prompt, d'accès cookies ou d'écriture navigateur.

Les points de départ des sélecteurs sont tirés de références publiques :

- DeepSeek : `.ds-assistant-message-main-content`, observé dans
  https://github.com/Siamsnus/domlogger et
  https://github.com/ShaoqiLiang/DeepSeek-Exporter.
- Gemini : conteneur `model-response` et contenu
  `message-content.model-response-text .markdown`, documentés dans
  https://github.com/YosefHayim/ai-browser-bridge et
  https://gist.github.com/ipcamit/f449fb95f3d7709091a210d1c23a1ed0.
- Mistral : conteneur `[data-message-author-role="assistant"]` suivi de son
  unique `.markdown`, d'après
  https://github.com/Eshaan-Nair/ArcRift/blob/main/PLATFORM_SELECTORS.md.

**Qwen : recherche de sélecteurs suffisamment fiables incomplète.** Sa
connexion CDP et son origine restent reconnues mais ce parseur refuse
explicitement le chemin de lecture ; aucune extraction générique/ambiguë
n'est tentée pour faire croire à une prise en charge.

Ces structures changent sans préavis. Le code refuse l'absence d'un identifiant
de réponse stable, plusieurs blocs markdown ambigus, toute réécriture non
préfixe, toute navigation/changement de génération, perte de permission ou
réponse trop grande. Il n'émet aucune fin générative fabriquée. Les tests CI
Linux utilisent un **seul Chromium temporaire** et trois pages HTTPS servies
en HTML synthétique local, sans comptes tiers, et vérifient les refus et la
non-divulgation de contenu utilisateur, raisonnement et champ mot de passe.
Windows n'exécute que les tests de refus sans ouvrir Chromium.

Une capture d'un vrai site connecté et un tour modèle OpenCode→site→SSE restent
à démontrer. G147 interdit d'inférer une identité OS/Desktop de CDP ou HTTP
Basic. Aucun indicateur de production ne change : **0/5**, **0/54**, aucune
écriture ni autorité Electron attestée. Production **NO-GO**.
