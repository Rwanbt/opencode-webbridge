/**
 * Idempotent GitHub issue publisher for planning/backlog.json.
 * Manual only: `node scripts/sync-github-issues.mjs --apply`.
 * Requires authenticated GitHub CLI; never called from CI.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const repo = 'Rwanbt/opencode-webbridge';
const apply = process.argv.includes('--apply');
const backlog = JSON.parse(readFileSync(new URL('../planning/backlog.json', import.meta.url), 'utf8'));
const byID = new Map();

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`gh ${args.slice(0, 3).join(' ')} failed (${result.status}): ${(result.stderr || result.error?.message || '').slice(0, 600)}`);
  }
  return result.stdout.trim();
}

if (!apply) {
  console.log(`DRY RUN: ${backlog.epics.length} epics and ${backlog.stories.length} stories. Use --apply to create missing GitHub issues.`);
  process.exit(0);
}

// Search includes closed issues so rerunning cannot accidentally duplicate retired stories.
const remote = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '500', '--json', 'number,title,url']));
for (const issue of remote) {
  const match = /^\[((?:US-)?E[0-8](?:-\d{2})?)\]/.exec(issue.title);
  if (match) byID.set(match[1], { number: issue.number, url: issue.url });
}

const labelDefinitions = [
  ['kind:epic', '5319E7', 'Roadmap epic'],
  ['kind:user-story', '0E8A16', 'Acceptance-driven user story'],
  ['priority:P0', 'B60205', 'Blocking prerequisite'],
  ['priority:P1', 'FBCA04', 'Main delivery work'],
  ['priority:P2', 'C5DEF5', 'Enhancement'],
  ...backlog.epics.map((epic) => [`area:${epic.id}`, '1D76DB', epic.title]),
];
for (const [name, color, description] of labelDefinitions) {
  gh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force']);
}

function create(id, title, body, labels) {
  if (byID.has(id)) {
    console.log(`EXISTS ${id}: #${byID.get(id).number}`);
    return;
  }
  // `--body-file -` accepts input on stdin, avoiding shell interpolation of markdown content.
  const args = ['issue', 'create', '--repo', repo, '--title', `[${id}] ${title}`, '--body-file', '-'];
  for (const label of labels) args.push('--label', label);
  const result = spawnSync('gh', args, { encoding: 'utf8', input: body, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`create ${id} failed: ${(result.stderr || result.error?.message || '').slice(0, 650)}`);
  const url = result.stdout.trim();
  const number = Number(url.match(/\/(\d+)\s*$/)?.[1]);
  if (!number) throw new Error(`Cannot parse issue number from ${url}`);
  byID.set(id, { number, url });
  console.log(`CREATED ${id}: #${number}`);
}

for (const epic of backlog.epics) {
  const stories = backlog.stories.filter((s) => s.epic === epic.id);
  create(epic.id, epic.title,
    `# Epic ${epic.id}\n\n**Outcome:** ${epic.outcome}\n\n**Stories:** ${stories.map((s) => s.id).join(', ')}\n\n**Plan:** https://github.com/${repo}/blob/main/docs/PLAN-GLOBAL.fr.md\n\n**Gate:** Every story has explicit acceptance, verification and dependencies; provider usage stays disabled without authorization.`,
    ['kind:epic', `area:${epic.id}`]);
}

for (const story of backlog.stories) {
  const epicLink = byID.get(story.epic)?.url;
  const depLinks = story.depends.map((id) => byID.has(id) ? `[${id}](${byID.get(id).url})` : id);
  const body = [
    `# ${story.id} — ${story.epic}`,
    '',
    `**User story:** As a ${story.persona}, I want to ${story.need}, so that ${story.value}.`,
    '',
    `**Priority:** ${story.priority} · **Size:** ${story.size} · **Epic:** ${epicLink ?? story.epic}`,
    '',
    '## Acceptance criteria',
    ...story.accept.map((c) => `- [ ] ${c}`),
    '',
    '## Verification',
    `- [ ] ${story.test}`,
    '- [ ] Regression/negative tests for risky boundaries where applicable',
    '- [ ] Typecheck and CI green on exact SHA, documentation updated, review complete',
    '',
    '## Dependencies',
    ...(depLinks.length ? depLinks.map((d) => `- ${d}`) : ['- None']),
    '',
    '**Source of truth:** https://github.com/Rwanbt/opencode-webbridge/blob/main/planning/backlog.json',
    '**Release guard:** Never enable or advertise an unverified web-chat adapter; do not circumvent provider restrictions.',
  ].join('\n');
  create(story.id, `${story.need.charAt(0).toUpperCase()}${story.need.slice(1)}`, body,
    ['kind:user-story', `area:${story.epic}`, `priority:${story.priority}`]);
}

const output = Object.fromEntries([...byID.entries()].sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(new URL('../planning/issue-map.json', import.meta.url), `${JSON.stringify({ repo, generatedAt: new Date().toISOString(), issues: output }, null, 2)}\n`);
console.log(`SYNCED ${byID.size} entries. Saved planning/issue-map.json`);
