import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../planning/backlog.json', import.meta.url);
const data = JSON.parse(readFileSync(fileURLToPath(root), 'utf8'));

function assert(condition, message) {
  if (!condition) throw new Error(`Backlog invalid: ${message}`);
}

const epics = new Set(data.epics.map((epic) => epic.id));
const ids = new Set(data.stories.map((story) => story.id));
assert(data.version && data.definitionOfDone, 'missing version / DoD');
assert(epics.size === data.epics.length, 'duplicate epic');
assert(ids.size === data.stories.length, 'duplicate story');
assert(data.epics.length === 9, 'expected nine epics');
assert(data.stories.length >= 50, 'expected at least fifty detailed stories');

const byID = new Map(data.stories.map((story) => [story.id, story]));
for (const story of data.stories) {
  assert(/^US-E[0-8]-\d{2}$/.test(story.id), `invalid ID ${story.id}`);
  assert(epics.has(story.epic), `${story.id}: unknown epic`);
  assert(['P0','P1','P2'].includes(story.priority), `${story.id}: invalid priority`);
  assert(['S','M','L'].includes(story.size), `${story.id}: invalid size`);
  assert(story.persona && story.need && story.value, `${story.id}: incomplete user story`);
  assert(Array.isArray(story.accept) && story.accept.length >= 2, `${story.id}: need >=2 acceptance criteria`);
  assert(typeof story.test === 'string' && story.test.length, `${story.id}: missing verification`);
  assert(Array.isArray(story.depends), `${story.id}: missing dependency list`);
  for (const dep of story.depends) assert(ids.has(dep) && dep !== story.id, `${story.id}: invalid dependency ${dep}`);
}

const visiting = new Set();
const visited = new Set();
function traverse(id) {
  if (visited.has(id)) return;
  assert(!visiting.has(id), `cycle detected at ${id}`);
  visiting.add(id);
  for (const dep of byID.get(id).depends) traverse(dep);
  visiting.delete(id);
  visited.add(id);
}
for (const story of data.stories) traverse(story.id);

console.log(`Backlog valid: ${data.epics.length} epics, ${data.stories.length} stories, no unknown/cyclic dependencies`);
