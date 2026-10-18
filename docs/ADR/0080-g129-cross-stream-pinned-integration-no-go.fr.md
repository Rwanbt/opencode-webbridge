# ADR 0080 — G129, consolidation réelle des branches CLI, provenance et lecture durable

**Statut : Draft, NO-GO production.** Branche isolée dérivée de #205
(`63092b5003f8af5284cd1b737e900c704eeab2a4`), sans merge Git ni changement upstream.

## Sources réellement portées

- **G125 / PR #204** head `a8a96d0640b147154f1e3def279444904cbc08ef`,
  base #200 : scripts/fixture et jobs officiels CLI **2.0.32**, modèle synthétique
  installé en un `.tgz`, page locale Chromium, DOM, RPC progressif, SSE et
  persistance de session après redémarrage de `opencode serve`.
- **G126 / PR #206** head `30ead17b53b7f8f742fed3a69e98d64f28f2f477`,
  base #199 : patch upstream V2 exact pour le refus du premier attachement
  sans autorité OS fiable et le refus d'usurpation du handler RPC
  `experimental.browser` par un plugin tiers. SHA256 de l'artefact binaire
  conservé : `1F6A0137F29FC074EAF67B09C85B50C9D544B809B98463A167C324189E2E1F27`.
  La règle `.gitattributes` empêche toute transformation CRLF de ce patch
  de sécurité sous Windows ; ses whitespace historiques ne sont pas édités.
- **G127 / PR #203** et **G128 / PR #205** : réception locale chiffrée avec ACK
  idempotent, témoin indépendant, tombstone et refus des frames/claims mutables.
  Les tests de lecture sont inclus au job Windows et à `npm test`.

## Contrôles intégrés

Le même **commit WebBridge** fournit tous les scripts, modèles, tests, ADR et
patch expérimental : CI Linux G125 exécute la chaîne CLI 2.0.32 réelle avec
Chromium local, CI Linux upstream checkout et applique le patch G126 sur
le commit officiel exact `4617210822bdbb31e5749751afbfb4584ccedac8`,
teste ses chemins Core/plugin-browser natifs adversariaux, puis les tests
Node du sink/read observer et Windows valident la persistance et l'anti-TOCTOU.
`check:g119` exige la provenance exacte G126 **et** la fixture G125 ; une
substitution par l'ancien patch G106 ou une altération de fixture échoue.

**Attention : cette cohabitation dans le même commit/CI n'est PAS une
exécution du Core patché par le vrai processus `@opencode/cli@2.0.32`.**
Le CLI installé reste le binaire officiel intact ; le patch native V2 est
appliqué séparément à une copie source de validation, jamais à l'installation
officielle de l'utilisateur. Le sink G127 est raccordé seulement à l'interface
de l'observateur de fixture et pas au stockage Core de production.

## Gates qui restent fermés

Absence d'attestation OS Desktop transportée à Core ; first attach strict
fail-closed ; aucune E2E Electron packagée ; aucune autorité révocable atomique
Core↔host↔driver ; pas de fournisseur commercial ni d'automatisation de page.
`nativeDesktopElectronE2E=false`,
`atomicCoreChromiumRevocation=false`,
`commercialAutomationAuthorized=false`,
`webbridgeWritesEnabled=false`,
`commercialProvidersOperational=[]`,
`productionAcceptedStoryIDs=[]`.

Pas d'activation WebBridge `navigate`/`click`/`fill`/`submit`,
pas de fusion de PR, pas de modification d'OpenCode officiel ni d'Unifia.
