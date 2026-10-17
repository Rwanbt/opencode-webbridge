# ADR 0030 — Erreur d'attachement avec résultat indéterminé

## RED observé

Après G82, si `host.port.claim()` acquiert la liaison puis lève une exception (accusé de réception perdu ou erreur de transport), le broker relançait directement l'exception sans nettoyage. Un test dynamique vérifiant la libération de la liaison échouait (`0 !== 1`). Un second test démontrait l'absence de quarantaine lorsque l'attachement et son nettoyage sont tous deux incertains.

## Correctif

La levée d'une exception par `port.claim` signifie **issue d'acquisition incertaine**, pas absence d'effet. Avant de déclarer le refus, le broker entre en quarantaine et appelle `port.release` sur la liaison exacte. Si le nettoyage réussit, la quarantaine est levée mais l'appel retourne `outcome uncertain`, sans nouvelle tentative automatique. Si le nettoyage échoue, la quarantaine persiste et bloque une seconde attache, toute opération et le désenregistrement jusqu'à récupération opérateur. Les deux tests d'erreur de transport et de nettoyage défaillant passent après correction avec la suite existante.

## Limites / NO-GO

`BrowserHostCapability` est un broker de référence hors ligne; il n'atteste pas l'identité du vrai processus Electron et ne synchronise pas atomiquement une autorisation Core avec l'effet Chromium. Aucun write WebBridge activé. Aucun fournisseur commercial contacté; 0/5 opérationnel, 0 acceptation production. Journal durable et reprise du host doivent être certifiés séparément, aucune fusion.
