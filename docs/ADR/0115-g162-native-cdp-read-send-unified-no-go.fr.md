# ADR 0115 — G162 : composition Native CLI, CDP lecture et envoi autorisé

**Décision :** consolider les incréments indépendants dans une seule branche
sans fusionner les PR Draft ni modifier l'application OpenCode officielle.

La base G162 est G161 #240 (G160 #238, G157 #236, G154 #233), comprenant
les contrats d'activation personnelle sans veto commercial général, le vrai
paquet root `.tgz`, CLI officiel 2.0.32, modèle local de test, DOM/RPC/Git
read-only, SSE et reprise, ainsi que la découverte CDP et les observateurs
DOM ChatGPT, DeepSeek, Gemini, Mistral. Le transport ne déclare aucun résultat
réel de fournisseur à ce stade ; Qwen DOM reste non vérifié.

G162 reporte les changements techniques exactement délimités de G158 #237
(courses du compagnon et second appel modèle) et de G159 #239 (envoi ChatGPT
one-shot avec approbation humaine liée au hash du prompt et journal durable
**consommé avant tout effet**). Les jobs Linux CI G153 et G159 sont lancés
sur **le même SHA** que ceux G155/G157/G160/G161, sans simplifier leur
contrôle ni partager les profils navigateur.

Les ADR de branches parallèles ont été réindexés pour éviter les collisions :
G158 est 0113 et G159 est 0114 dans ce dossier intégré ; le contenu technique
de provenance est préservé. Le code des modules repris n'est pas présenté
comme des lignes nouvellement conçues en G162.

**Limites maintenues :** `src/index.ts` n'est pas branché sur un fournisseur
réel, le Core natif patché reste expérimental et distinct du Core officiel,
aucune attestation OS/Desktop Electron, aucun compte web authentifié testé,
aucune soumission vraie confirmée par un fournisseur, aucun droit de navigation
ou écriture activé dans WebBridge distribué. Même le retour d'un envoi G159
est **incertain**, jamais une preuve d'acceptation fournisseur. Les six gates
production restent à l'état négatif : 0/5 live, 0/54 L3, writes OFF, release
**NO-GO**. Prochaine étape : vraie session utilisateur autorisée et binding
modèle OpenCode→transport→réponse SSE avec provenance vérifiable.
