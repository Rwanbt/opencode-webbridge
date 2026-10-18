# Diagnostics d'installation WebBridge

Vérifie une installation **locale expérimentale** : manifeste, version, intégrité
d'archive et configuration. Fail-closed : tout fait non prouvé refuse
l'installation. Aucun secret lu, aucun accès réseau, aucune configuration
globale OpenCode modifiée.

## Exécution

```powershell
npm run build
npm run diagnose:install -- <dossier-plugin-installe>
npm run diagnose:install -- <dossier> 0.0.0 --archive <tarball.tgz> --sha256 <hex>
```

Codes de sortie : `0` PASS (+ avis), `1` FAIL (findings), `2` usage.

## Findings (refus, ordre fixe)

| Code | Signification | Action |
| --- | --- | --- |
| `manifest-unreadable` | `package.json` absent ou illisible/invalide | réinstaller depuis l'archive officielle |
| `manifest-name-mismatch` | nom du paquet inattendu | vérifier l'archive et la source |
| `manifest-version-invalid` | version absente ou non sémantique | reconstruire le paquet |
| `expected-version-invalid` | version attendue invalide | corriger la commande de diagnostic |
| `version-mismatch` | version installée ≠ attendue | mettre à jour ou rollback vers la version attendue |
| `integrity-invalid` | hash attendu malformé ou absent côté observé | fournir `--archive` et `--sha256` corrects |
| `integrity-mismatch` | archive altérée ou version différente | refuser l'archive, réinstaller depuis la source vérifiée |
| `config-invalid: <détail>` | configuration locale invalide (raison du validateur) | corriger la configuration, consulter le détail |

## Avis (PASS, mais à connaître)

| Avis | Signification |
| --- | --- |
| `config-absent` | aucune configuration locale : défauts sûrs (`enabled=false`) |
| `config-disabled` | WebBridge désactivé (état par défaut) |
| `providers-empty` | aucun fournisseur sélectionné |

## Périmètre et limites

- Fixture locale et CLI expérimental uniquement : voir `planning/compatibility.json`
  (`check:compat`) pour le périmètre exact de chaque version annoncée. Desktop
  Electron 2.0.32 : NON PROUVÉ, jamais extrapolé depuis le CLI.
- Fournisseurs commerciaux : 0/5 opérationnels ; aucune automatisation autorisée.
- Écritures navigateur : désactivées.
- Cycle de vie complet (installation, mise à jour, rollback, désinstallation) :
  voir ADR 0028 et les tâches CI `preview:package`, `preview:rpc-package`,
  `preview:g97` et les smoke tests natifs 2.0.29.
