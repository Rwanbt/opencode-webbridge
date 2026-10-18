# ADR 0112 — G161 : epoch du document CDP, refus du reload à URL constante

Une identité d'onglet CDP `(tabID, generation, url)` peut rester **identique**
lorsqu'un navigateur recharge entièrement la même adresse. Un résultat DOM
pourrait alors provenir d'un autre document sans que G155 le remarque.

G161 ajoute une preuve séparée, propre au document, sur les lecteurs G157
(ChatGPT) et G160 (DeepSeek, Gemini, Mistral) : `Page.getFrameTree` donne
`frame.id`, `frame.loaderId`, `frame.url` de la frame principale. Le lecteur
capture ces valeurs à l'attachement, vérifie l'URL attendue et exige le même
couple `(frameID, loaderID)` avant et après toute attente d'autorisation et
toute évaluation de DOM. Un changement de loader ID, **même avec exactement
la même URL et le même ID d'onglet**, rend la lecture invalide. Aucun contenu
du nouveau document n'est émis. Cette preuve n'est pas un principal OS.

Les tests Linux utilisent la vraie API CDP de Chromium et rechargent la même
URL HTTPS (interception locale HTML), après une lecture positive et avant une
nouvelle lecture refusée. Les refus Windows ne nécessitent pas de navigateur.

Limites maintenues : aucun site authentifié, aucune interaction externe, aucun
envoi de prompt, aucune preuve Electron/IPC/Core OS ni changement de l'OpenCode
officiel. **Production NO-GO : 0/5 fournisseurs et 0/54 stories L3.**
