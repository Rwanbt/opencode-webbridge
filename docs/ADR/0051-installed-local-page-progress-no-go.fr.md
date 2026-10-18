# ADR 0051 — G99 : paquet RPC+modèle installé et DOM Chromium local

**Statut : test d'intégration natif Linux uniquement ; production NO-GO.**

G97 (#178) atteste que **un seul tarball autonome** fournit le modèle
fictif et le RPC OpenCode CLI 2.0.29. G66 prouve une vraie page Chromium
locale, mais charge deux plugins de développement. G99 unit ces preuves :
le même `index.mjs` installé depuis `.tgz` enregistre aussi un RPC
de session locale `webbridge-g99-page` (submit/take/progress/complete/poll).
La configuration OpenCode ne référence **aucun répertoire plugin modèle**.

Un navigateur Chromium et un serveur `local-chat-page` sont créés une seule
fois pour les deux essais séquentiels : paquet 0.0.2 après upgrade puis
0.0.1 après rollback. Le vrai DOM reçoit le prompt synthétique,
émet trois fragments, retransmis via RPC progressif authentifié ;
un faux serveur OpenAI-compatible **localhost uniquement** reçoit
les événements RPC, les diffuse comme fragments SSE et le CLI officiel
`run --server --model webbridge-fixture/webbridge-native-fixture`
doit recevoir la réponse déterministe `WEBBRIDGE_LOCAL_PAGE_OK:...`.
Les retries de complétion du moteur peuvent relire le même tour déjà
vérifié, sans relancer l'action DOM. Le résultat terminal doit confirmer
la suite exacte de trois événements et un `finished`.

Les tests négatifs rejettent mauvaise autorité/portée, mauvais ordre ou
curseur, prompt non autorisé, double soumission, événement rejoué,
fin anticipée et fin falsifiée. Le navigateur bloque les URL hors
`http://127.0.0.1:<port>/` et les chemins différents. Aucun profil
navigateur utilisateur, compte, page commerciale, cookie ou credential
réel n'est utilisé. Le même banc conserve les vérifications G97 d'archive
reproductible, tampering, rollback, HMAC du challenge natif et uninstall.

**Limites :** ce RPC page est uniquement une simulation en mémoire,
non un broker d'autorité Browser/Computer Use ou un service commercial.
Le test du navigateur sur le poste Windows est interdit ici compte
tenu des ressources (risque Chromium 0x800705AF) ; seule la CI Linux
effectue les essais lourds. Une CI verte ne prouve **ni OpenCode
Desktop/Electron 2.0.32, ni vraie intégration fournisseur, ni
authentification commerciale, ni politique d'autorisation de navigation**.
Interruption réelle/tab switch et déconnexion réseau en plein tour
restent hors de cette preuve sauf tests distincts explicitement réussis.
**0/5 fournisseurs commerciaux, 0 production, aucune fusion.**
