# ADR 0046 — G92 : évaluation du Desktop installé, aucune preuve Electron

**Statut : SKIP_UNSAFE observé, NO-GO Desktop/Electron.**

Le 17 octobre 2026, l'exécutable installé se trouve sous
`%LOCALAPPDATA%/Programs/OpenCode/OpenCode.exe` (version 2.0.32.0,
signature Authenticode **Valid**, Anomaly Innovations). Le sidecar
`resources/opencode-cli.exe` est également signé ; son `ProductVersion`
Windows affiche **1.4.2**, alors que `resources/opencode-cli.version`
indique **2.0.32**. Le marqueur de version est donc préféré au champ
Windows du sidecar ; il ne prouve pas à lui seul une transaction RPC.

Le préflight du poste a relevé **1,747 Gio libres** sur 15,71 Gio et
**six processus OpenCode.exe existants**. La politique G92 exige
**au moins 6 Gio physiques libres** et **zéro instance Desktop** :
aucun Electron, Chromium, nouveau CLI ou binaire officiel n'a été lancé,
arrêté, recompilé, remplacé ou mis à jour.

Le code de référence Desktop v2 (commit officiel `4617210`),
`packages/desktop/src/main/lifecycle/configure.ts`, n'honore
`OPENCODE_DESKTOP_TEST_ROOT` que pour les builds non empaquetés
(hors mode onboarding explicite) ; on ne doit donc **pas** présenter
cette variable comme garantie pour `OpenCode.exe` installé.
`packages/desktop/scripts/bench-startup.ts` fournit une approche
d'isolation par `USERPROFILE/HOME/APPDATA/LOCALAPPDATA/XDG_*`,
`OPENCODE_DB`, `OPENCODE_CONFIG_DIR` et proxy fermé local.
Ce précédent source n'est **pas** une attestation de l'artefact installé
2.0.32, notamment de son service intégré, du sélecteur de modèle,
du stockage renderer ou des redirections de profil.

Le harnais G92 refuse sur mémoire insuffisante, processus existants,
signature non valide, marqueur incohérent, jonction/reparse, sonde
inaccessible ou OS non Windows. **Même si les critères passent, son
état est REVIEW_ONLY : il n'exécute jamais Desktop.** Les tests
vérifient ces refus et préparent/effacent un profil temporaire
`g92-desktop-isolation-*` contenant seulement la fixture RPC G81.
Aucun secret/provider personnel n'est recopié ; la fermeture nettoie
uniquement le dossier que le harnais a lui-même créé. La CI peut
valider les gardes en mode synthétique et imprimer `SKIP_UNSAFE`
sur les runners sans application installée. Une CI verte ne prouve
**aucune activation Electron**, aucun élément visuel dans le modèle
picker et aucun tour de modèle du Desktop installé.

**Pour lever le NO-GO :** disposer d'au moins 6 Gio libres, fermer les
instances Desktop par le propriétaire (pas par le test), attester
l'isolation réelle et les flux réseau du binaire installé 2.0.32,
obtenir le consentement explicite pour un **unique** essai Playwright
Electron strictement local avec teardown et vérification de
l'absence d'effets sur le profil personnel. Le préflight actuel n'a
pas cette preuve et **ne lance rien**. L'intégration G88 reste une
preuve de CLI officiel + modèle/RPC fictifs, non une preuve Desktop.

**Commerciaux : 0/5. Production : 0. Fusion : aucune.**
