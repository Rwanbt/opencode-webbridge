import { readFileSync } from 'node:fs';

const read = (filename) => JSON.parse(readFileSync(new URL(`../planning/${filename}`, import.meta.url), 'utf8'));
const backlog = read('backlog.json');
const map = read('issue-map.json');
const progress = read('progress.json');
const assert = (condition, message) => { if (!condition) throw new Error(`Progress evidence invalid: ${message}`); };

assert(progress.version === 1 && /^\d{4}-\d{2}-\d{2}$/.test(progress.asOf), 'unknown snapshot version/date');
assert(progress.policy.includes('draft') && progress.policy.includes('production'), 'no release disclaimer');
assert(backlog.epics.length === 9 && backlog.stories.length === 54, 'backlog shape changed');
assert(Object.keys(map.issues).length === 63, 'expected 9 epic and 54 story issue references');
assert(progress.stories.length === 54, 'all 54 user stories require a status');
const byID = new Map(backlog.stories.map((story) => [story.id, story]));
const seen = new Set();
let documented = 0;
for (const entry of progress.stories) {
  const story = byID.get(entry.id);
  assert(story && !seen.has(entry.id), `unknown/duplicate story ${entry.id}`);
  seen.add(entry.id);
  assert(map.issues[entry.id]?.number === entry.issue, `${entry.id} issue mismatch`);
  assert(['planned', 'partial', 'blocked'].includes(entry.state), `${entry.id} unsupported completion claim`);
  assert(Array.isArray(entry.criteria) && entry.criteria.length === story.accept.length, `${entry.id} criteria changed`);
  for (const evidence of entry.criteria) {
    assert(['unverified', 'fixture-evidenced', 'documentation-evidenced', 'blocked'].includes(evidence),
      `${entry.id} cannot declare acceptance from a fixture`);
  }
  assert(Array.isArray(entry.prs) && entry.prs.every((number) => Number.isInteger(number) &&
    progress.proofPRs[number]), `${entry.id} unknown proof PR`);
  assert(entry.state !== 'partial' || entry.prs.length > 0, `${entry.id} missing partial evidence`);
  if (entry.criteria.some((value) => value.endsWith('-evidenced'))) {
    assert(entry.prs.length > 0, `${entry.id} claim without a proof`);
    documented++;
  }
}
for (const [number, proof] of Object.entries(progress.proofPRs)) {
  assert(Number(number) >= 67 && Number(number) <= 93, `unknown PR ${number}`);
  assert(proof.url === `https://github.com/Rwanbt/opencode-webbridge/pull/${number}`, `wrong PR URL ${number}`);
  assert(/^[0-9a-f]{40}$/.test(proof.headSHA), `invalid SHA ${number}`);
  assert(proof.review === 'draft-not-merged', `unsupported merge/readiness assertion ${number}`);
}
const byStatus = (status) => progress.stories.filter((story) => story.state === status).length;
assert(['US-E5-02', 'US-E5-03', 'US-E5-04', 'US-E5-05', 'US-E5-06']
  .every((id) => progress.stories.find((story) => story.id === id)?.state === 'blocked'),
  'commercial consumer providers cannot be marked production ready');
console.log(`Progress evidence valid: 9 epics, 54 stories, 66 issues (3 milestones), ${byStatus('partial')} partial, ${byStatus('blocked')} blocked, ${byStatus('planned')} planned, ${documented} fixture/docs-evidenced; zero production-accepted`);
