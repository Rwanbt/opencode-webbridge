import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/acceptance-matrix.json');
const matrix = JSON.parse(readFileSync(path, 'utf8'));
const backlog = JSON.parse(readFileSync(resolve(root, 'planning/backlog.json'), 'utf8'));
const progress = JSON.parse(readFileSync(resolve(root, 'planning/progress.json'), 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`Acceptance matrix: ${reason}`); };

ensure(matrix.schemaVersion === 1, 'unsupported schema');
ensure(matrix.observedAt === '2026-10-18', 'observation requires a new review');
ensure(Object.keys(matrix).sort().join(',') === 'accepted,gate,levels,observedAt,schemaVersion,stories', 'unexpected fields');

const levels = matrix.levels;
ensure(levels && Object.keys(levels).sort().join(',') === 'L0,L1,L2,L3', 'level set');
ensure(Object.values(levels).every((v) => typeof v === 'string' && v.length >= 16), 'level definitions');
ensure(typeof matrix.gate === 'string' && matrix.gate.length >= 16, 'gate statement');

const stories = matrix.stories;
ensure(Array.isArray(stories) && stories.length === 54, 'story count');
ensure(stories.every((s) => Object.keys(s).sort().join(',') === 'evidence,id,level'), 'story fields');
ensure(stories.map((s) => s.id).join(',') === backlog.stories.map((s) => s.id).join(','),
  'stories must match the backlog exactly (set and order)');
for (const story of stories) {
  ensure(['L0', 'L1', 'L2', 'L3'].includes(story.level), `unknown level for ${story.id}`);
  ensure(typeof story.evidence === 'string', `evidence must be a string for ${story.id}`);
  if (story.level !== 'L0') ensure(story.evidence.length >= 8, `level ${story.level} requires verifiable evidence for ${story.id}`);
}

ensure(Array.isArray(matrix.accepted), 'accepted must be an array');
const accepted = [...matrix.accepted].sort().join(',');
const l3 = stories.filter((s) => s.level === 'L3').map((s) => s.id).sort().join(',');
ensure(accepted === l3, 'accepted list must equal exactly the L3 stories');
const progressAccepted = [...progress.acceptance.productionAcceptedStoryIDs].sort().join(',');
ensure(accepted === progressAccepted, 'accepted list must match progress.json productionAcceptedStoryIDs');

const counts = { L0: 0, L1: 0, L2: 0, L3: 0 };
for (const story of stories) counts[story.level] += 1;
console.log(`Acceptance matrix PASS: 54 stories (L2 ${counts.L2}, L1 ${counts.L1}, L0 ${counts.L0}); ` +
  `accepted ${counts.L3}/54 — L3 requires a real authorized external interaction`);
