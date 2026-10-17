# ADR 0029 — Révocation pendant l'acquisition d'un host navigateur (fixture)

## Reproduction RED

Un test déterministe laisse le driver acquérir la liaison avant de résoudre `await host.port.claim(binding)`, puis retire le consentement. Sur G79 non corrigé, `BrowserHostCapability.claim` renvoie un succès et conserve un attachement acquis sans dernière vérification de l'autorité. Le test initial échoue par `Missing expected rejection`.

## Choix fail-closed

Après l'acquisition asynchrone réussie, le broker vérifie à nouveau le consentement et les deux permissions natives, ainsi que l'identité du host. Si un contrôle échoue, il met le host en quarantaine, tente le nettoyage ciblé `port.release`, puis refuse l'attachement; le test vérifie que le driver n'est plus propriétaire de la session. Si la libération échoue, l'instance reste en quarantaine, interdit les opérations et le désenregistrement, et exige une récupération opérateur. Un test RED→GREEN demeure exécuté dans la suite `browser-host-capability`.

## NO-GO

Cette amélioration concerne le broker de fixture, **pas** une attestation cryptographique ou système du vrai processus Electron Desktop. Entre le contrôle Core et un effet Chromium, la fenêtre interprocessus n'est toujours pas fermée; les writes WebBridge restent désactivés. La preuve n'autorise aucun fournisseur commercial ou collecte de cookies/credentials. 0/5 fournisseurs commerciaux opérationnels, 0 acceptation production, aucune fusion.
