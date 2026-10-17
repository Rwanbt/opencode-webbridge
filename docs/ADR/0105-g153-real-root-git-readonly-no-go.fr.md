# ADR 0105 — G153 : lectures Git vraies sous modèle officiel et reçu durable

**Statut : fixture Linux CI à prouver, production NO-GO.**
Base G152 #230 HEAD `647ec65ea8daac68a3c6479f99562f921a0e3e89`,
10/10 CI push + 10/10 PR vérifiés. Worktree nouveau, aucun merge.

G152 raccorde le vrai paquet WebBridge root (inactif par défaut, modèle local
activé exclusivement en profil jetable) à un tour OpenCode CLI officiel2.0.32,
Chrome DOM local, RPC, lecture fichier G145 et reprise SSE chiffrée. Les
opérations `git.status`, `git.diff`, `git.log` n'avaient pas encore
été déclenchées par un tour réellement sélectionné dans ce root.

Dans G153, le host de test crée un dépôt Git **temporaire** avec un commit
initial, modifie volontairement une copie `proof.txt` avant la demande,
puis reçoit trois propositions **JSON strictes** dans le même tour
modèle/RPC. `OfflineToolTurnOrchestrator` lie chacune à la session
officielle, demande l'autorisation/confirmation **simulées** du host,
persiste un journal de consommation distinct et utilise G135 avec
`--no-optional-locks`, isolation du profil Git, bornes d'exécution,
de séquence, de taille et de sortie, sans `git add/commit/push/reset`
sur l'effet. Chaque résultat est borné et vérifié ; l'index Git est
comparé **octet par octet** avant/après exécution et redémarrage.

La lecture du même événement DOM est acquittée chiffrée avant SSE,
la vraie session CLI est relue après redémarrage, les trois journaux
d'effet sont confirmés puis refusent toute tentative de rejeu. Le host
SSE G148 n'exécute jamais d'outil sur une reprise data-only ; un compte
forgé ou une génération incompatible ne peut pas reprendre ses trames.

La prise en charge Windows de fichiers locaux sans handles OS
sécurisés reste **fermée** : seuls les tests de refus tournent sur
cette plateforme, sans nouvelles fenêtres Chromium. La fixture Git
n'autorise **aucun outil Git natif production**, ni l'usage d'un véritable
worktree de l'utilisateur.

Le Core officiel de 2.0.32 reste non patché, Desktop Electron non
attesté, et l'authentification HTTP du RPC n'est **pas** une identité
OS fiable. Les API web commerciales ne sont pas appelées. Les six
indicateurs restent `0/5`, `0/54`, Desktop/atomic/automation/writes
`false`. Aucune story production acceptée.
