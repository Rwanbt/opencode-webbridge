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
ensure(Array.isArray(progress.evidence) && progress.evidence.length === 13, 'unsupported evidence count');
const ids = new Set();
for (const e of progress.evidence) {
  ensure(Number.isInteger(e.pr) && e.pr >= 142 && e.pr <= 154 && !ids.has(e.pr), 'duplicate/unknown PR');
  ids.add(e.pr);
  ensure(/^[a-f\d]{40}$/.test(e.sha), 'invalid commit SHA');
  ensure(e.checks === (e.pr >= 152 ? 8 : 6), 'inexact check count');
  ensure(typeof e.scope === 'string' && e.scope.endsWith('-partial'), 'CI is not production acceptance');
}
ensure(Array.isArray(progress.blockers) && progress.blockers.length >= 5, 'missing release blockers');
console.log('Progress guard PASS: 9 epics, 54 stories, 66 issues; 13 partial PRs; 0/5 commercial, 0 accepted');
