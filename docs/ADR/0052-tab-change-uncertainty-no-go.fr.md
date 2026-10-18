# ADR 0052 — G100 : changement d'onglet, tour incertain, refus de succès implicite

**Décision : fail-closed local test-only ; aucune certification navigateur commercial.**

G99 #180 atteste un tour positif à travers un paquet unique `.tgz`,
OpenCode CLI 2.0.29, une vraie page Chromium locale, 3 fragments DOM
via RPC et un modèle fictif SSE. G100 ajoute une faute *pendant*
un autre tour réel sur le même Chromium, sans créer un nouveau profil :
après le premier fragment DOM accepté, le navigateur est déplacé vers
`about:blank`. Le compagnon signale `uncertain(tab-changed)` à une
méthode RPC du **même paquet installé**. Les appels tardifs `progress`,
`complete`, `submit` et un second `uncertain` doivent être rejetés.
Le journal du RPC mémoire contient `text(seq=1)` puis
`cancelled(seq=2)`, **jamais** `finished`.

Le faux modèle HTTP local émet au plus le fragment partiel, puis termine
le SSE par **destruction du flux**, sans trame finale `[DONE]`.
Un compteur de fins normales différencie un flux interrompu d'une
réponse terminée. Le client CLI est ensuite arrêté volontairement et
de façon bornée par le harnais (plafond 15 s), **pas** par le serveur
commercial ni par une API d'annulation de production. Son résultat ne
doit pas contenir la réponse déterministe complète. Cette preuve
démontre l'absence de terminal réussi pour le tour injecté ; elle
**ne démontre pas** une reconnexion/session récupérée, ni une
interruption autonome du CLI sans intervention du test.

Le même job Linux CI conserve les deux parcours positifs après
upgrade `0.0.2` et rollback `0.0.1`, puis réutilise **le Chromium
et la page locale existants** pour la faute de navigation sur un
serveur CLI temporaire neuf, avec le paquet `0.0.1` déjà installé.
Le profil est éphémère, les secrets synthétiques, le modèle désactive
les outils et seuls localhost et `about:blank` sont utilisés.
Sous Windows, le risque mémoire `0x800705AF` interdit les tests
Chromium lourds. Le banc n'utilise jamais OCDX.

**NO-GO :** l'autorité est celle du contrat de test local, pas une
attestation Core/Browser de l'OpenCode officiel installé.
L'expérience ne prouve ni Electron/Desktop, ni fournisseurs réels,
ni reprise sûre après reconnexion, ni accès navigateur en écriture.
**0/5 commerciaux, 0 production, aucune fusion.**
