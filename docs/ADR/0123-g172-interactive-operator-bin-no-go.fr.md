# ADR 0123 — Commande de tour ChatGPT explicitement pilotée par l'opérateur

Le paquet npm brut inclut maintenant `webbridge-manual-chatgpt`. La commande exige un terminal interactif, un navigateur Chromium CDP existant expressément déclaré comme appartenant à l'utilisateur, un onglet choisi, une session/un tour identifiés et un répertoire de journal privé. Elle affiche la cible, le hash du prompt et le prompt entier **sur le terminal local uniquement**, puis exige `YES` pour l'envoi exact; le journal G159 consomme avant tout effet et interdit le rejeu aveugle.

Exemple, uniquement après avoir volontairement préparé son navigateur et son répertoire privé :

`webbridge-manual-chatgpt --owned-browser --endpoint http://127.0.0.1:9222 --tab TAB_ID --session SESSION_ID --turn TURN_ID --journal PATH`

La commande refuse l'exécution non interactive. Ses observations sont des candidats **non attribués de façon certaine** et se concluent par `UNCERTAIN`, jamais par une réponse fournisseur certifiée. Elle n'est pas un modèle natif ni un système SSE OpenCode. Les comptes personnels, Electron et la production restent non testés; aucun contrôle CAPTCHA/authentification n'est contourné.
