# ADR 0098 — G146, qualification commune d'un tour d'outil hors ligne et du paquet racine

**Décision : qualification CI, NO-GO production maintenu.** G146 part exclusivement de G144 #222 au commit vérifié `963a98692764ce07e23245bd820143f56827749b` (push `39073466420` et PR `39073515358`, 8/8 succès chacun). La source finale corrigée G145 #223 est `27e3e919b1a9429a6304d0f500760d2d9819ec7d` : push `39074049262` et PR `39074053583` terminés SUCCESS, 7/7 chacun. L'ancien SHA `4b648a1` a été remplacé après découverte d'une révocation possible pendant `await verifyReceipt`.

## Intégration contrôlée

Les trois fichiers G145 **corrigés** sont copiés exactement : `src/testing/offline-tool-turn-orchestrator.ts`, `test/offline-tool-turn-orchestrator.test.ts` et ADR 0097. L'étape Windows ciblée de G145 est rejouée telle quelle dans la CI de G144. Une étape Linux explicite exécute la même suite après `npm test`, afin de rendre visibles sur **un seul SHA** les vrais fichiers temporaires et Git, le JSON strict G138, l'autorité de test G133, le `ToolBroker`, la consommation durable G140 avant toute lecture G135, la vérification du reçu, **la réautorisation après le `await` du reçu** et le refus du rejeu après reprise. Les tests Windows applicables prouvent uniquement les rejets prévus ; ils ne qualifient aucune lecture de fichiers Windows.

La CI préserve également la validation G134 E5 hors ligne, G141 sécurité/autorité, le patch natif Core V2 appliqué à la source officielle `4617210822bdbb31e5749751afbfb4584ccedac8` (SHA-256 exact `77B5FF872F5F3D1EB641896AD16FC6C50D8F21AD54BFA797D7519F1990A0685F`), les fixtures séparées CLI officiel 2.0.32 Chromium/DOM/RPC/SSE et ACK hôte chiffré/restart G125/G130, et le **véritable paquet racine inerte** installé, mis à niveau, restauré et désinstallé dans un profil temporaire G143. Le plugin distribué `src/index.ts` reste inchangé et non opérationnel.

## Frontières explicites

L'orchestrateur et les callbacks d'autorisation/reçu sont des **fixtures host** dans `src/testing/`, sans autorité OS réelle, sans effet navigateur commercial et sans attestation de Core natif dans le même processus que le CLI public ou Desktop Electron. Un anti-rollback protégé par l'OS et l'autorité de permissions native restent à prouver. Aucun fournisseur réel ni compte commercial n'est testé ; aucune écriture navigateur, commande terminal ou mutation Git n'est autorisée. Aucune publication ou fusion n'est déduite des CI vertes.

`commercialProvidersOperational=[]` (0/5), `productionAcceptedStoryIDs=[]` (0/54), `webbridgeWritesEnabled=false`, `commercialAutomationAuthorized=false`, `nativeDesktopElectronE2E=false` ; **NO-GO-PRODUCTION** inchangé.
