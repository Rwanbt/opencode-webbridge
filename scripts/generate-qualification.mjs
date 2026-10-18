/** Generates the release qualification report (decision → blockers → indicators
 *  → acceptance tally → proved/unproved capabilities → required consents → wave
 *  inventory) from the machine-readable planning sources, so the released state
 *  can never drift from what was actually verified.
 *
 *  Complements `docs/TRACEABILITY.fr.md`: the matrix maps every story, this
 *  report states the release-level verdict and the exact pull-request inventory.
 *
 *  Usage: node scripts/generate-qualification.mjs [--write]
 *  Without --write it prints the document to stdout (the test uses the printer). */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'docs/QUALIFICATION.fr.md');
const SOURCES = {
  backlog: 'planning/backlog.json',
  acceptance: 'planning/acceptance-matrix.json',
  progress: 'planning/progress.json',
  posture: 'planning/release-posture.json',
};

export async function loadSources(root = ROOT) {
  const read = async (file) => JSON.parse(await readFile(resolve(root, file), 'utf8'));
  const [backlog, acceptance, progress, posture] = await Promise.all([
    read(SOURCES.backlog), read(SOURCES.acceptance), read(SOURCES.progress), read(SOURCES.posture),
  ]);
  return { backlog, acceptance, progress, posture };
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const short = (text, max = 150) => {
  const clean = cell(text);
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
};

/** The wave of pull requests opened by this effort; the earlier window is
 *  recorded as partial evidence but is not re-listed here. */
const WAVE_FROM = 258;

/** Capabilities that cannot be proved without the user's explicit consent or a
 *  public API that does not exist yet. Kept literal so a test can pin them and
 *  so the report can never quietly drop a required consent. */
export const REQUIRED_CONSENTS = [
  'P0 — une session ChatGPT réelle autorisée : profil Chrome/Chromium dédié (port CDP 9222), '
    + 'un onglet `chatgpt.com` déclaré, un seul envoi de test.',
  'Adaptateurs live des cinq fournisseurs — les mêmes sessions authentifiées, déclarées onglet par '
    + 'onglet (ChatGPT, DeepSeek, Gemini, Qwen, Mistral Le Chat).',
  'Desktop/Electron packagé — une API publique d\'installation d\'extension (aujourd\'hui refusée en '
    + 'mode packagé) et un profil Desktop jetable.',
];

/** Pure renderer: same inputs always produce the same document. */
export function renderQualification({ backlog, acceptance, progress, posture }) {
  const level = new Map(acceptance.stories.map((story) => [story.id, story.level]));
  const tally = { L0: 0, L1: 0, L2: 0, L3: 0 };
  const byLevel = { L0: [], L1: [], L2: [], L3: [] };
  for (const story of backlog.stories) {
    const lvl = level.get(story.id) ?? 'L0';
    if (tally[lvl] !== undefined) { tally[lvl] += 1; byLevel[lvl].push(story.id); }
  }
  const total = backlog.stories.length;
  const a = progress.acceptance;
  const blockers = posture.blockers ?? [];
  const gap = a.productionAcceptedStoryIDs?.length ?? 0;
  const commercial = a.commercialProvidersOperational?.length ?? 0;

  const lines = [];
  lines.push('# Rapport de qualification (généré)');
  lines.push('');
  lines.push('> **Document généré** par `npm run docs:qualification` — ne pas éditer à la main.');
  lines.push('> Sources : `planning/release-posture.json`, `planning/progress.json`,');
  lines.push('> `planning/acceptance-matrix.json`, `planning/backlog.json`. Un test vérifie que ce');
  lines.push('> fichier reste identique à la sortie du générateur (dérive = échec). La matrice détaillée');
  lines.push('> est dans `docs/TRACEABILITY.fr.md`.');
  lines.push('');

  lines.push('## 1. Décision de release');
  lines.push('');
  lines.push('| Champ | Valeur |');
  lines.push('| --- | --- |');
  lines.push(`| Décision | \`${cell(posture.decision)}\` |`);
  lines.push(`| Périmètre autorisé | ${cell(posture.allowedClaims?.scope)} |`);
  lines.push(`| Desktop/Electron | \`${posture.allowedClaims?.desktop}\` ${posture.allowedClaims?.desktop ? '' : '(non prouvé)'} |`);
  lines.push(`| Fournisseurs commerciaux opérationnels | \`${posture.allowedClaims?.commercialProviders}\` (0/5) |`);
  lines.push(`| Écritures navigateur | \`${posture.allowedClaims?.browserWrites}\` |`);
  lines.push(`| Acceptation production | \`${posture.allowedClaims?.productionAccepted}\` |`);
  lines.push('');

  lines.push('## 2. Indicateurs (inchangés sans preuve vérifiable)');
  lines.push('');
  lines.push('| Indicateur | Valeur |');
  lines.push('| --- | --- |');
  lines.push('| `productionAcceptedStoryIDs` | `[' + (a.productionAcceptedStoryIDs ?? []).join(', ') + ']` |');
  lines.push('| `commercialProvidersOperational` | `[' + (a.commercialProvidersOperational ?? []).join(', ') + ']` |');
  lines.push(`| \`nativeDesktopElectronE2E\` | \`${a.nativeDesktopElectronE2E}\` |`);
  lines.push(`| \`atomicCoreChromiumRevocation\` | \`${a.atomicCoreChromiumRevocation}\` |`);
  lines.push(`| \`commercialAutomationAuthorized\` | \`${a.commercialAutomationAuthorized}\` (métadonnée historique) |`);
  lines.push(`| \`webbridgeWritesEnabled\` | \`${a.webbridgeWritesEnabled}\` |`);
  lines.push('');

  lines.push('## 3. Bloqueurs de release');
  lines.push('');
  lines.push('| ID | Statut | Preuve |');
  lines.push('| --- | --- | --- |');
  for (const blocker of blockers) {
    lines.push(`| \`${cell(blocker.id)}\` | ${cell(blocker.status)} | ${short(blocker.evidence)} |`);
  }
  lines.push('');
  lines.push(`Bloqueurs techniques enregistrés dans \`planning/progress.json\` : **${progress.blockers?.length ?? 0}** `
    + '— Desktop non attesté, révocation Core→Chromium non atomique, effets incertains post-crash, '
    + 'Git/terminal/sous-agents natifs, cinq transports web réels non vérifiés, Electron E2E manquant.');
  lines.push('');

  lines.push('## 4. Acceptation des stories');
  lines.push('');
  lines.push(`- Niveaux : **L0** ${tally.L0} · **L1** ${tally.L1} · **L2** ${tally.L2} · **L3** ${tally.L3}`);
  lines.push(`- Stories au total : **${total}** (9 épics E0–E8)`);
  lines.push(`- Stories acceptées production : **${gap}/${total}**`);
  lines.push(`- ${short(acceptance.gate, 220)}`);
  lines.push('');

  lines.push('## 5. Base de preuves');
  lines.push('');
  const evidence = progress.evidence ?? [];
  const last = evidence[evidence.length - 1];
  lines.push(`- preuves partielles enregistrées : **${evidence.length}** `
    + '(fenêtre couverte exactement une fois, vérifiée par `npm run check:progress`)');
  lines.push(`- rouges superseded pinnés (SHA + motif) : **${progress.unverified?.length ?? 0}**`);
  lines.push(`- dernier SHA vérifié enregistré : **PR #${last?.pr}** @${short(last?.sha, 40)} `
    + `(${last?.checks} checks, périmètre \`${last?.scope}\`)`);
  lines.push('');

  lines.push(`## 6. Inventaire de la vague (#${WAVE_FROM}+, PR Draft, aucune fusionnée)`);
  lines.push('');
  lines.push('| PR | SHA | Checks | Périmètre |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of evidence.filter((item) => item.pr >= WAVE_FROM)) {
    lines.push(`| #${entry.pr} | \`${short(entry.sha, 40)}\` | ${entry.checks} | \`${cell(entry.scope)}\` |`);
  }
  lines.push('');

  lines.push('## 7. Capacités prouvées / non prouvées');
  lines.push('');
  lines.push(`**Prouvées sur la surface installée (L2, ${tally.L2}) :** `
    + (byLevel.L2.join(', ') || 'aucune'));
  lines.push('');
  lines.push(`**Implémentées hors surface installée (L1, ${tally.L1}) :** `
    + (byLevel.L1.join(', ') || 'aucune'));
  lines.push('');
  lines.push(`**Acceptées production (L3, ${tally.L3}) :** `
    + (byLevel.L3.join(', ') || 'aucune — voir les consentements requis.'));
  lines.push('');
  lines.push('Non revendiqué : conversation web authentifiée des cinq fournisseurs (0/5), exactly-once '
    + 'bout-en-bout, reprise sur session fournisseur réelle, Desktop/Electron packagé, cœur patché, '
    + 'attestation d\'identité OS.');
  lines.push('');

  lines.push('## 8. Consentements requis (avant toute conversation web réelle)');
  lines.push('');
  for (const consent of REQUIRED_CONSENTS) lines.push(`- ${consent}`);
  lines.push('');
  lines.push('Aucune autorisation commerciale générale n\'est exigée : l\'activation est individuelle '
    + '(choix utilisateur, session accessible, capacités prouvées, permissions, règles fournisseur, sécurité).');
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = renderQualification(await loadSources());
  if (process.argv.includes('--write')) {
    await writeFile(OUT, document);
    console.log('wrote docs/QUALIFICATION.fr.md');
  } else {
    console.log(document);
  }
}
