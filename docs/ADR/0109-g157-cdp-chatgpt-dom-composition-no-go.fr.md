# ADR 0109 — G157 : lecture ChatGPT réelle via CDP et observateur DOM raccordés

**Décision : première composition exécutable du transport G155 et de l'adaptateur G156, sans revendiquer un fournisseur LIVE de production.**

G157 repart de #233 (véritable root CLI + politique d'activation personnelle) et
porte les changements indépendants vérifiés de #234 (DOM ChatGPT) et #235 (CDP
Chromium existant), sans modifier ces PR ni l'OpenCode officiel. Les ADR
indépendants ont des numéros uniques 0107/0108.

`G157ChatgptCdpObserver.attach()` demande un endpoint explicite `127.0.0.1`,
le consentement de découverte G155, l'ID exact d'un onglet ChatGPT déjà
ouvert, ainsi qu'un contrôle **indépendant et révocable** de lecture du texte.
Il relie un target ID CDP vérifié à une page existante via Playwright
`connectOverCDP`, sans lancer Chrome ni écrire dans le profil. Le callback
d'évaluation n'admet qu'une fonction DOM **fixe et auditable** de G156, pas du
JavaScript arbitraire fourni par le modèle ou la page. Il revérifie ID, URL,
génération et permission avant et après la lecture asynchrone. `sample` et
`observe` exposent les fragments de l'unique réponse ChatGPT sélectionnée,
sans fabriquer un événement `finished` lorsque le DOM ne prouve pas la fin.

La lecture du DOM sélectionné utilise sous le capot la capacité CDP de
Playwright `Runtime.evaluate` avec une fonction fixe en lecture seule ; c'est
une extension explicite du lecteur G155, qui reste limité à l'accessibilité
et n'expose jamais de commande CDP arbitraire. Un port CDP donne des droits
élevés à ses clients et **ne fournit aucune attestation d'identité OS**.

La CI Linux raccorde sur un **Chromium réel isolé** les deux bibliothèques :
une page `https://chatgpt.com` servie par interception locale, un ID de
target effectif, une réponse DOM progressive, révocation en cours de session,
changement d'origine et absence de divulgation du champ mot de passe.
Windows ne lance pas de Chromium et vérifie seulement les négatifs.

Le prochain lot doit raccorder ce lecteur à la session/modèle officiel, puis
ajouter l'envoi après consentement et la finalité fournisseur attestée.
Ici aucun compte authentifié, aucune soumission, aucune réponse d'un vrai
service externe, aucune autorisation OS/Desktop Electron ni écriture navigateur
ne sont prouvés. Production : **NO-GO ; 0/5 fournisseurs, 0/54 stories acceptées**.
