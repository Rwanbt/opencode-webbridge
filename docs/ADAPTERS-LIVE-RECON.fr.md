# Reconnaissance des interfaces réelles (adapters-live)

Statut : **reconnaissance read-only**, 2026-10-18. Aucun envoi effectué sur ces onglets.
Chaque sélecteur ci-dessous est **observé sur l'interface réelle** mais n'est pas encore
« validé » au sens de P0 tant qu'un envoi réel vérifié n'a pas eu lieu.

## Méthode (sans secret, sans envoi)

- Attachement CDP en lecture seule à l'onglet **déjà authentifié par l'utilisateur**
  (`http://127.0.0.1:9222#<tabID>`), profil jetable dédié.
- Sondage du compositeur + des contrôles ; remplissage d'un marqueur puis **effacement**,
  **sans jamais cliquer** le contrôle d'envoi.
- Aucun cookie, jeton, mot de passe ni contenu privé n'est lu.

## Constat transverse

Comme ChatGPT (corrigé dans #282), les quatre autres interfaces **montent leur contrôle
d'envoi seulement après saisie** et n'exposent **aucun `aria-label`/`data-testid` stable**
pour l'envoi. La forme « compositeur exigé avant remplissage, contrôle d'envoi résolu après »
est donc la règle, pas l'exception.

## ChatGPT — validé (P0)

- Compositeur : `div[role="textbox"][contenteditable="true"]` (`aria-label` « Demander à ChatGPT »).
- Envoi : `button[aria-label="Envoyer"]` (`type=submit`), monté après saisie.
- Lecture : `div[data-content-search-unit-key$=":assistant"]` →
  `[data-markdown-text-style="assistant-message"]`.
- Statut : **prouvé de bout en bout** (tarball brut → CLI 2.0.32 → réponse réelle
  `2 + 2 = 4.` → persistance → redémarrage).

## DeepSeek — observé

- Compositeur : `textarea` (placeholder « Message à DeepSeek »), unique et visible.
- Envoi : **aucun `<button>`** ; le contrôle est un `div[role="button"]` portant une icône
  SVG (flèche), classes **hachées** (`ds-button …`), sans `aria-label` ni `data-testid`.
  → Sélecteur structurel nécessaire (conteneur du compositeur, `div[role="button"]` avec
  `svg`, dernier de la rangée), à valider par un envoi réel unique.
- Attention : la cible CDP change après un rechargement d'onglet (identité à re-résoudre à
  chaque attachement).

## Gemini — observé

- Compositeur : `div[role="textbox"][contenteditable="true"]`
  (`aria-label` « Saisissez un prompt pour Gemini »), plusieurs candidats textbox →
  unicité à garantir.
- Envoi : icône seule, montée après saisie (aucun `aria-label` de type « send » détecté).

## Qwen — observé

- Compositeur : `textarea` (placeholder « Comment puis-je vous aider aujourd'hui ? »).
- Envoi : icône seule, montée après saisie.
- Rappel : Qwen était `discoverable:false` / `NO_GO_UNVERIFIED_LIVE_QWEN_DOM` ; cette
  reconnaissance est la première observation réelle de son compositeur.

## Mistral Le Chat — observé

- Compositeur : `div[contenteditable="true"]`.
- Envoi : icône seule, montée après saisie.
- Note : l'onglet observé est sur `/work` (Vibe Work) ; confirmer l'origine
  `https://chat.mistral.ai` et l'écran de chat attendu avant tout envoi.

## Plan d'implémentation (un fournisseur à la fois, un envoi réel par fournisseur)

1. Étendre le registre (`src/providers/provider-adapters.ts`) : `sendPrimitiveOf(<id>)`
   déclare la primitive d'envoi du fournisseur.
2. Ajouter un module d'envoi par fournisseur, calqué sur G159 : compositeur exigé avant
   remplissage, contrôle d'envoi résolu **après**, one-shot durable consommé **avant** tout
   effet UI, aucun rejeu après consommation.
3. Étendre l'attachement consenti (`consented-cdp-attachment.ts`) au fournisseur, avec le
   même re-liage **same-origin** qu'après un envoi ChatGPT.
4. Vérifier par **un envoi réel unique** puis lecture progressive, persistance, redémarrage.
5. Ne déclarer le fournisseur opérationnel qu'après cette preuve, fournisseur par
   fournisseur ; les autres restent explicitement non prouvés.

Ordre : **DeepSeek**, puis Gemini, Qwen, Mistral (priorité de la mission).
