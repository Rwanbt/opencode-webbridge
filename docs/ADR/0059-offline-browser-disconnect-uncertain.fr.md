# ADR 0042 — Déconnexion navigateur : état incertain terminal (G112)

## Décision

Le RPC de page locale du plugin de test G97/G99 accepte `browser-disconnected` comme cause explicite de transition `uncertain`, après prise du tour. Il conserve le fragment déjà publié, émet un seul événement terminal `cancelled`, puis refuse progression, succès fabriqué, second terminal et nouvel envoi. Aucun rejeu automatique.

## Preuve bornée

Test `g112-disconnect-uncertainty.test.ts` : RED sur G100 (`G100 uncertainty transition denied`) puis GREEN 1/1 après changement, avec G100 1/1 toujours vert. L'autorité synthétique reste un secret de fixture, non une identité de processus Desktop.

## NO-GO

Il s'agit d'une **transition RPC en mémoire**, pas d'une détection effective de perte du transport ni d'un test de crash. La reconnexion, le redémarrage, le journal durable, l'atomicité Core–Desktop–Chromium et le véritable Electron restent non prouvés. Les écritures navigateur restent désactivées ; 0/5 fournisseur commercial, 0 story acceptée en production. Aucune dépendance OCDX.
