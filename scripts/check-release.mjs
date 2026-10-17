import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/release-posture.json');
const posture = JSON.parse(readFileSync(path, 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`Release guard: ${reason}`); };

const progress = JSON.parse(readFileSync(resolve(root, 'planning/progress.json'), 'utf8'));
const acceptance = JSON.parse(readFileSync(resolve(root, 'planning/acceptance-matrix.json'), 'utf8'));
const compatibility = JSON.parse(readFileSync(resolve(root, 'planning/compatibility.json'), 'utf8'));

ensure(posture.schemaVersion === 1, 'unsupported schema');
ensure(posture.observedAt === '2026-10-17', 'observation requires a new review');
ensure(Object.keys(posture).sort().join(',') === 'allowedClaims,blockers,decision,observedAt,schemaVersion', 'unexpected fields');

ensure(posture.decision === 'NO-GO-PRODUCTION', 'production release remains refused');
const claims = posture.allowedClaims;
ensure(claims && Object.keys(claims).sort().join(',') === 'browserWrites,commercialProviders,desktop,productionAccepted,scope', 'allowedClaims fields');
ensure(typeof claims.scope === 'string' && claims.scope.startsWith('CLI experimental'), 'only the CLI experimental scope may be announced');
ensure(claims.desktop === false, 'desktop claims are not permitted');
ensure(claims.commercialProviders === 0, 'commercial providers are not permitted');
ensure(claims.browserWrites === false, 'browser writes are not permitted');
ensure(claims.productionAccepted === false, 'no story is production-accepted');

// Live cross-checks: the posture can never disagree with the enforced gates.
const desktop = compatibility.products.find((product) => product.id === 'opencode-desktop-electron');
ensure(desktop && desktop.proven === false, 'compatibility still refuses the desktop proof');
ensure(compatibility.providers.operational === claims.commercialProviders, 'commercial count must match the compatibility matrix');
ensure(compatibility.browserWritesEnabled === false, 'browser writes still disabled in the compatibility matrix');
ensure(progress.acceptance.productionAcceptedStoryIDs.length === 0, 'progress still refuses production acceptance');
ensure(acceptance.accepted.length === 0, 'acceptance matrix still refuses production acceptance');

const BLOCKERS = [
  'desktop-electron-e2e',
  'atomic-core-chromium-revocation',
  'native-effect-wiring',
  'commercial-live-automation',
  'production-acceptance',
];
ensure(Array.isArray(posture.blockers) && posture.blockers.map((blocker) => blocker.id).join(',') === BLOCKERS.join(','),
  'exact blocker set and order required');
const STATUS = new Set(['NOT-PROVEN', 'BLOCKED-UPSTREAM', 'BLOCKED-CONTRACT']);
for (const blocker of posture.blockers) {
  ensure(Object.keys(blocker).sort().join(',') === 'evidence,id,status', 'blocker fields');
  ensure(STATUS.has(blocker.status), `blocker ${blocker.id} must stay unresolved`);
  ensure(typeof blocker.evidence === 'string' && blocker.evidence.length >= 16, `blocker ${blocker.id} requires evidence`);
}

const counts = posture.blockers.reduce((acc, blocker) => {
  acc[blocker.status] = (acc[blocker.status] ?? 0) + 1;
  return acc;
}, {});
console.log('Release guard PASS: NO-GO-PRODUCTION — CLI experimental (linux fixture smoke) scope only; ' +
  `${posture.blockers.length} blockers unresolved (${counts['NOT-PROVEN'] ?? 0} not-proven, ` +
  `${counts['BLOCKED-UPSTREAM'] ?? 0} upstream, ${counts['BLOCKED-CONTRACT'] ?? 0} contract); ` +
  '0/54 accepted; 0/5 commercial; writes disabled');
