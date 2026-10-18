# Proposition upstream — capacité navigateur publique pour un plugin serveur

Statut : **proposition**, pas un ADR ; aucun numéro ADR n'est revendiqué. Aucun patch du
cœur distribué n'est produit ici. La proposition sœur sur le modèle fourni par un plugin
est `docs/proposals/plugin-provided-language-model.fr.md`.

## Contexte

WebBridge doit piloter une session web **déjà authentifiée** (propriété de navigation et
d'onglet), sans clé d'API d'inférence. Le dépôt sait déjà le faire **par le transport CDP
consenti qu'il possède** : l'utilisateur déclare un onglet, WebBridge s'y attache via CDP,
avec permission native, anti-rejeu durable et terminaux honnêtes. Ce chemin fonctionne
aujourd'hui et ne dépend d'aucune API nouvelle.

La demande de l'utilisateur porte sur une seconde voie : utiliser le **navigateur intégré
d'OpenCode** plutôt qu'une instance Chrome/Chromium séparée. Cette voie est
aujourd'hui **fermée par la surface publique** : un plugin serveur ne reçoit aucune
capacité navigateur. Cette proposition documente la surface réellement observée, la limite
démontrée, et la demande minimale pour que le navigateur intégré soit utilisable par un
plugin — sans contourner quoi que ce soit.

## Surface publique observée (faits, reproductibles hors ligne)

- `@opencode/plugin@2.0.29` n'expose que les domaines `app, host, options, permission, rpc,
  runtime, runtime-modules, source, source.bun, source.node, source.package, storage,
  worktree`. **Aucun domaine `browser`.**
- Le witness de compilation du dépôt (`test/browser-host-capability.test.ts`) établit que
  `Plugin.Context` possède `rpc` et `permission`, mais **pas** `browser` : ajouter la clé
  casserait le typage et déclencherait la garde.
- La sonde officielle `npm run check:d01d02` conclut `NO_GO_PACKAGED_GUI_EXTENSION`
  (`packagedManagerCalls: 0`, `serverPluginRenderer: false`, `nativeDesktopExecuted: false`) :
  en mode packagé, l'IPC d'extension renvoie « unavailable » avant tout effet, et le Context
  serveur n'expose aucun domaine renderer/gui/browser.
- `PLAN-GLOBAL.fr.md` acte la même limite : l'espace `browser` des outils de l'agent contrôle
  le navigateur attaché à **Desktop**, ce qui « ne prouve pas qu'un plugin de serveur puisse
  le commander directement ».

Conclusion factuelle : **NO PUBLIC** plugin browser capability aujourd'hui.

## Ce qui existe déjà côté WebBridge (le côté consommation est prêt)

Le dépôt implémente déjà le contrat de consommation attendu, dans
`src/core/browser-host-capability.ts` :

- `BrowserPort` : `claim(binding)`, `submit(binding, request)`, `events(binding, turnID,
  afterSeq)`, `cancel(binding, turnID)`, `release(binding)`.
- `BrowserHostRegistration` : `{ binding: TabClaim, port: BrowserPort, consented: () => Promise<boolean> }`
  — un hôte **de confiance et autorisé par l'utilisateur** fournit ces trois éléments.
- `BrowserHostCapability` est fail-closed : **aucun hôte enregistré ⇒ toute opération est
  refusée**. Il vérifie le consentement de l'hôte **avant et après** chaque attente, et exige
  les deux actions de permission natives `browser` puis `webbridge_browser`.

Autrement dit : la seule pièce manquante est la **production** de cet hôte par OpenCode.

## Demande minimale

1. **Capacité `ctx.browser` (ou équivalent public).** Exposer au plugin un objet de forme
   `BrowserPort` (`claim`, `submit`, `events`, `cancel`, `release`), limité à une session et
   à un onglet **explicitement attachés**. Alternative acceptable : une API dédiée
   `ctx.browser.attach({ sessionID, providerID, tabID })` renvoyant la même forme.
2. **Permission et consentement.** Conserver le modèle existant : l'action native `browser`
   reste la règle de refus intégrée, et `webbridge_browser` peut porter le refus par
   fournisseur/onglet. Le consentement est **détenu par l'hôte** et revérifié autour de
   chaque attente sensible.
3. **Aucun secret.** La capacité ne doit jamais exposer cookies, jetons ou mots de passe :
   seulement des identifiants opaques et des événements de tour bornés (texte/terminal).
4. **Identité d'onglet et de génération.** La capacité doit refuser un onglet remplacé ou
   rechargé (identité + génération), cohérent avec la portée `{tabID, generation}` du dépôt.
5. **Terminal honnête.** La capacité doit pouvoir distinguer une réponse terminée d'une
   réponse d'achèvement non prouvable ; sans quoi WebBridge conservera `UNCERTAIN`
   (voir la proposition modèle pour l'état terminal).

## Hors périmètre

- Aucun contournement d'authentification, de CAPTCHA ou de règles fournisseur.
- L'attestation OS/Desktop et la révocation atomique Core→Chromium restent des limites
  distinctes (non résolues ici).
- Aucun patch du cœur distribué : la proposition est indépendante.

## Preuves exécutables

- `scripts/probe-plugin-browser-capability.mjs` — sonde déterministe de la surface publique
  installée ; verdict `NO_PUBLIC_PLUGIN_BROWSER_CAPABILITY` (version épinglée, domaines
  énumérés, aucune déclaration navigateur).
- `test/plugin-browser-capability.test.ts` — verrouille le verdict, fige la liste des
  domaines (une future capacité navigateur **casse** le test, ce qui force l'adoption), et
  vérifie que la demande correspond mot pour mot au contrat de consommation
  `BrowserHostRegistration` déjà implémenté et testé.
- `test/browser-host-capability.test.ts` — witness de compilation `browser: false` et preuve
  que la consommation est fail-closed et redemande permission et consentement.
