# ADR 0058 — Desktop officiel empaqueté 2.0.32 : contrôle négatif documenté

**Décision : SKIP_NO_ELECTRON_E2E / NO-GO Desktop.**

Le poste Windows conserve moins de 6 Gio libres (environ 1 Gio selon la
dernière observation), six processus OpenCode déjà démarrés et un précédent
échec Chromium `0x800705AF` : aucun nouveau Desktop, Electron ou Chromium
n'a été lancé, arrêté, remplacé ou recompilé.

Le **tag officiel** `anomalyco/opencode/v2.0.32` désigne le commit
`843a6c514e606b436a7fe713422ace0a93ad3d61`. Le banc G111
lit uniquement deux sources depuis ce SHA immuable, vérifie leur SHA256,
et contrôle le flux officiel `latest-linux.yml` de `opencode.ai`.
Le 17 octobre 2026, ce flux proposait 2.0.32 avec AppImage
`opencode-desktop-linux-x86_64.AppImage` (274 268 075 octets) et
un SHA512 de transfert. Aucune release GitHub `v2.0.32` n'exposait
un artefact Linux signé : la signature d'éditeur **indépendante**
de cet AppImage n'est pas attestée. Un SHA512 indiqué par le même
distributeur que le fichier ne constitue pas une preuve de signature.
**Aucun binaire de 274 Mo n'est téléchargé ou exécuté en CI.**

Preuve d'interface et d'isolation sur le code exact 2.0.32 :

* `packages/desktop/src/main/lifecycle/configure.ts` active le
  `remote-debugging-port` seulement si `!app.isPackaged`, et ignore
  `OPENCODE_DESKTOP_TEST_ROOT` en build empaqueté normal.
* `packages/desktop/src/main/service/background-service.ts` limite
  `OPENCODE_DESKTOP_ISOLATED_SERVER` aux builds non empaquetés et peut
  reprendre un service déjà présent via `sidecarProbe`.
* Ces éléments **ne prouvent pas l'absence universelle** de support
  d'extensions graphiques ; ils montrent que le protocole de test isolé
  actuellement utilisé n'est pas attesté pour le binaire empaqueté.
  Ni l'affichage du modèle du paquet G97/G100 dans le sélecteur GUI,
  ni sa découverte par le sidecar empaqueté ne sont prouvés.

Le script exécutable refuse les sources modifiées, origine CDN inattendue,
version de flux déplacée, manifeste altéré, signatures absentes, RAM
insuffisante ou processus existants. Il produit toujours
`SKIP_NO_ELECTRON_E2E` : une CI verte atteste **uniquement** que
le garde-fou a fonctionné, jamais un test GUI réussi.

Pour autoriser un vrai E2E : identité de publication signée vérifiable
pour l'artefact Linux, isolation démontrée des magasins GUI/sidecar,
instrumentation officielle du sélecteur de modèles et vérification
des effets réseau/fichiers, puis essai borné en profil jetable.
Le CLI natif de G100 n'est pas une preuve Electron.

**OCDX exclu. 0/5 commerciaux, 0 production. Aucun merge.**
