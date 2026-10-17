# ADR 0034 — Relais navigateur hors ligne : interruption HTTP jusque dans le poll

Statut : incrément expérimental **NO-GO production**, 17 octobre 2026.

## Problème et preuve RED

G84 détecte la fermeture SSE côté réponse HTTP, mais le générateur `streamBrowserTurn`
reste bloqué dans un `BrowserPort.events` encore en attente. Le test HTTP réel
`HTTP client disconnect interrupts a pending browser event poll without replaying the turn`
échouait sur G84 : **0** tentative de `BrowserPort.cancel` au lieu de **1**,
après le premier delta et la déconnexion du lecteur.

## Décision G87

- Propager `AbortSignal` de `openFixtureServer` à `browserFixtureStreamResponder`
  et `browserFixtureResponder`, puis aux collecteurs `streamBrowserTurn` et
  `exchangeBrowserTurn`.
- Détacher l'attente de `submit` ou `events` dès l'annulation, même si la promesse
  du pilote n'aboutit jamais. Retirer les listeners d'interruption après règlement.
- Refuser toute émission ultérieure / faux terminal ; ne jamais recommencer un
  `submit` potentiellement appliqué. Pour un tour déjà envoyé, tenter une seule
  annulation **best effort**, sans prétendre qu'un ACK manquant prouve l'absence
  d'effet. Un refus ou un échec de `cancel` laisse le résultat **incertain**.
- Refuser avant toute soumission lorsque le signal est déjà interrompu.

## Validation et limites

RED observé avec vraie requête HTTP loopback, delta progressif et poll du pilote
volontairement suspendu. GREEN : tentative d'annulation, 1 seul `submit`, 1 seul
delta ; tests supplémentaires avant `submit` et pendant son ACK suspendu.
La suite ciblée G87 est validée localement, les checks CI au SHA exact doivent
être vérifiés séparément. Aucun compte ni URL commerciale.

**NO-GO** : la promesse interne du pilote peut survivre à cette interruption ;
un `cancel=false` (pilote ayant déjà acquis le tour) ou l'absence d'ACK ne
certifie pas le retrait d'un effet Chrome. Le journal durable, l'autorité
transactionnelle Core ↔ Desktop ↔ Chromium et le véritable Electron restent
non prouvés. `navigate/click/fill/submit` WebBridge demeurent désactivés.
Il ne s'agit que du transport de fixture local, pas d'un adaptateur commercial.
