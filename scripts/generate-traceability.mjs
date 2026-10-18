/** Generates the traceability matrix (Epic → Story → Issue → Level → Evidence)
 *  from the machine-readable planning sources, so the document can never drift
 *  from the backlog, the acceptance matrix, the issue map or the indicators.
 *
 *  Usage: node scripts/generate-traceability.mjs [--write]
 *  Without --write it prints the document to stdout (the test uses the printer). */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = resolve(ROOT, 'docs/TRACEABILITY.fr.md');
const SOURCES = {
  backlog: 'planning/backlog.json',
  acceptance: 'planning/acceptance-matrix.json',
  issues: 'planning/issue-map.json',
  progress: 'planning/progress.json',
};

export async function loadSources(root = ROOT) {
  const read = async (file) => JSON.parse(await readFile(resolve(root, file), 'utf8'));
  const [backlog, acceptance, issues, progress] = await Promise.all([
    read(SOURCES.backlog), read(SOURCES.acceptance), read(SOURCES.issues), read(SOURCES.progress),
  ]);
  return { backlog, acceptance, issues, progress };
}

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const short = (text, max = 120) => {
  const clean = cell(text);
  return clean.length <= max ? clean : clean.slice(0, max - 1) + '…';
};

/** Pure renderer: same inputs always produce the same document. */
export function renderTraceability({ backlog, acceptance, issues, progress }) {
  const level = new Map(acceptance.stories.map((story) => [story.id, story]));
  const issue = (id) => {
    const entry = issues.issues?.[id];
    return entry ? '#' + entry.number : '—';
  };
  const lines = [];
  lines.push('# Matrice de traçabilité (générée)');
  lines.push('');
  lines.push('> **Document généré** par `npm run docs:traceability` — ne pas éditer à la main.');
  lines.push('> Sources : `planning/backlog.json`, `planning/acceptance-matrix.json`,');
  lines.push('> `planning/issue-map.json`, `planning/progress.json`. Un test vérifie que ce fichier');
  lines.push('> reste identique à la sortie du générateur (dérive = échec).');
  lines.push('');
  lines.push('## Indicateurs (état exact, non modifiés sans preuve vérifiable)');
  lines.push('');
  const a = progress.acceptance;
  lines.push('| Indicateur | Valeur |');
  lines.push('| --- | --- |');
  lines.push('| `productionAcceptedStoryIDs` | `[' + (a.productionAcceptedStoryIDs ?? []).join(', ') + ']` |');
  lines.push('| `commercialProvidersOperational` | `[' + (a.commercialProvidersOperational ?? []).join(', ') + ']` |');
  lines.push('| `nativeDesktopElectronE2E` | `' + a.nativeDesktopElectronE2E + '` |');
  lines.push('| `atomicCoreChromiumRevocation` | `' + a.atomicCoreChromiumRevocation + '` |');
  lines.push('| `commercialAutomationAuthorized` | `' + a.commercialAutomationAuthorized + '` (métadonnée historique) |');
  lines.push('| `webbridgeWritesEnabled` | `' + a.webbridgeWritesEnabled + '` |');
  lines.push('');
  lines.push('Niveaux : **L0** absent · **L1** implémenté/vérifiable hors surface installée · '
    + '**L2** vérifié sur la surface installée en CI au SHA exact · '
    + '**L3** accepté production (session web réelle déclenchée par l\'utilisateur, jamais déduit d\'une fixture).');
  lines.push('');
  const totals = { total: 0, L0: 0, L1: 0, L2: 0, L3: 0 };
  const rowsByEpic = new Map();
  for (const story of backlog.stories) {
    const entry = level.get(story.id);
    const lvl = entry?.level ?? 'L0';
    totals.total += 1;
    if (totals[lvl] !== undefined) totals[lvl] += 1;
    if (!rowsByEpic.has(story.epic)) rowsByEpic.set(story.epic, []);
    rowsByEpic.get(story.epic).push({
      id: story.id, priority: story.priority, issue: issue(story.id),
      level: lvl, evidence: short(entry?.evidence ?? 'aucune preuve enregistrée'),
    });
  }
  lines.push('## Synthèse par épic');
  lines.push('');
  lines.push('| Épic | Titre | Issue | Stories | L0 | L1 | L2 | L3 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const epic of backlog.epics) {
    const rows = rowsByEpic.get(epic.id) ?? [];
    const count = (lvl) => rows.filter((row) => row.level === lvl).length;
    lines.push(`| ${epic.id} | ${cell(epic.title)} | ${issue(epic.id)} | ${rows.length} | `
      + `${count('L0')} | ${count('L1')} | ${count('L2')} | ${count('L3')} |`);
  }
  lines.push(`| **Total** | | | **${totals.total}** | **${totals.L0}** | **${totals.L1}** | **${totals.L2}** | **${totals.L3}** |`);
  lines.push('');
  for (const epic of backlog.epics) {
    lines.push(`## ${epic.id} — ${cell(epic.title)}`);
    lines.push('');
    lines.push(`_${cell(epic.outcome)}_`);
    lines.push('');
    lines.push('| Story | Prio | Issue | Niveau | Preuve (extrait) |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const row of rowsByEpic.get(epic.id) ?? []) {
      lines.push(`| ${row.id} | ${row.priority} | ${row.issue} | ${row.level} | ${row.evidence} |`);
    }
    lines.push('');
  }
  const unverified = progress.unverified?.length ?? 0;
  lines.push('## Base de preuves');
  lines.push('');
  lines.push(`- preuves partielles enregistrées : **${progress.evidence?.length ?? 0}** `
    + `(fenêtre couverte exactement une fois, vérifiée par \`npm run check:progress\`)`);
  lines.push(`- rouges superseded pinnés (SHA + motif) : **${unverified}**`);
  lines.push(`- bloqueurs de release : **${progress.blockers?.length ?? 0}** `
    + '(scope CLI 2.0.32, posture `NO-GO-PRODUCTION`)');
  lines.push(`- stories acceptées production : **${totals.L3}/${totals.total}** — `
    + 'L3 exige une interaction web réelle autorisée par l\'utilisateur (voir les phases bloquées).');
  lines.push('');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const document = renderTraceability(await loadSources());
  if (process.argv.includes('--write')) {
    await writeFile(OUT, document);
    console.log('wrote docs/TRACEABILITY.fr.md');
  } else {
    console.log(document);
  }
}
