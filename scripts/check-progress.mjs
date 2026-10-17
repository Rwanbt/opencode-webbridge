import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/progress.json');
const progress = JSON.parse(readFileSync(path, 'utf8'));
const backlog = JSON.parse(readFileSync(resolve(root, 'planning/backlog.json'), 'utf8'));
const mapping = JSON.parse(readFileSync(resolve(root, 'planning/issue-map.json'), 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`Progress guard: ${reason}`); };

ensure(progress.schemaVersion === 1, 'unsupported schema');
ensure(progress.observedAt === '2026-10-17', 'observation requires a new review');
ensure(progress.backlog.epics === backlog.epics.length && progress.backlog.epics === 9, 'epic count');
ensure(progress.backlog.stories === backlog.stories.length && progress.backlog.stories === 54, 'story count');
ensure(progress.backlog.mappedIssues === Object.keys(mapping.issues).length && progress.backlog.mappedIssues === 63, 'issue mapping count');
const numbers = Object.values(mapping.issues).map((entry) => entry.number);
ensure(new Set(numbers).size === 63 && [1, 2, 3].every((id) => !numbers.includes(id)), 'issue collision');
ensure(JSON.stringify(progress.backlog.crosscuttingIssues) === '[1,2,3]' && progress.backlog.totalIssues === 66, 'issue totals');
const a = progress.acceptance;
ensure(a && Object.keys(a).sort().join(',') ===
  'atomicCoreChromiumRevocation,commercialAutomationAuthorized,commercialProvidersOperational,nativeDesktopElectronE2E,productionAcceptedStoryIDs,webbridgeWritesEnabled', 'acceptance fields');
ensure(Array.isArray(a.productionAcceptedStoryIDs) && a.productionAcceptedStoryIDs.length === 0, 'production acceptance unproven');
ensure(Array.isArray(a.commercialProvidersOperational) && a.commercialProvidersOperational.length === 0, 'commercial providers unproven');
for (const name of ['nativeDesktopElectronE2E', 'atomicCoreChromiumRevocation', 'commercialAutomationAuthorized', 'webbridgeWritesEnabled'])
  ensure(a[name] === false, `unsafe production gate ${name}`);
const firstPR = 142;
const lastVerifiedPR = 173;
ensure(Array.isArray(progress.evidence) && progress.evidence.length === lastVerifiedPR - firstPR + 1,
  'unsupported evidence count');
const ids = new Set();
for (const e of progress.evidence) {
  ensure(Number.isInteger(e.pr) && e.pr >= firstPR && e.pr <= lastVerifiedPR && !ids.has(e.pr), 'duplicate/unknown PR');
  ids.add(e.pr);
  ensure(/^[a-f\d]{40}$/.test(e.sha), 'invalid commit SHA');
  ensure(e.checks === (e.pr <= 151 ? 6 : e.pr <= 167 ? 8 : 4), 'inexact check count');
  ensure(typeof e.scope === 'string' && e.scope.endsWith('-partial'), 'CI is not production acceptance');
}
ensure(Array.from({ length: lastVerifiedPR - firstPR + 1 }, (_, index) => firstPR + index)
  .every((pr) => ids.has(pr)),
  'every newly claimed PR must be evidenced');
ensure(Array.isArray(progress.epicEvidence) && progress.epicEvidence.length === backlog.epics.length,
  'missing epic evidence');
for (const [index, epic] of backlog.epics.entries()) {
  const entry = progress.epicEvidence[index];
  ensure(entry?.id === epic.id && entry.stories === backlog.stories.filter((story) => story.epic === epic.id).length,
    `${epic.id} story allocation mismatch`);
  ensure(entry.acceptedStories === 0, `${epic.id} cannot be production accepted by fixture CI`);
  ensure(Array.isArray(entry.verifiedPartialPRs) && entry.verifiedPartialPRs.length > 0 &&
    entry.verifiedPartialPRs.every((pr) => Number.isInteger(pr) && ids.has(pr)), `${epic.id} unknown PR proof`);
  ensure(typeof entry.criticalGap === 'string' && entry.criticalGap.length >= 20,
    `${epic.id} missing critical release gap`);
}
ensure(Array.isArray(progress.blockers) && progress.blockers.length >= 5, 'missing release blockers');
console.log(`Progress guard PASS: 9 epics, 54 stories, 66 issues; ${progress.evidence.length} partial PRs; 0/5 commercial, 0 accepted`);
