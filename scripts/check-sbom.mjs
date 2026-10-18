import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/sbom.json');
const sbom = JSON.parse(readFileSync(path, 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`SBOM guard: ${reason}`); };

ensure(sbom.schemaVersion === 1, 'unsupported schema');
ensure(sbom.observedAt === '2026-10-17', 'observation requires a new review');
ensure(Object.keys(sbom).sort().join(',') === 'generator,observedAt,packages,schemaVersion,totals', 'unexpected fields');
ensure(typeof sbom.generator === 'string' && sbom.generator.length >= 8, 'generator');
ensure(sbom.totals && Object.keys(sbom.totals).sort().join(',') === 'packages', 'totals fields');
ensure(Array.isArray(sbom.packages), 'packages must be an array');
ensure(sbom.packages.every((p) => Object.keys(p).sort().join(',') === 'integrity,name,version'), 'package fields');

const entries = Object.entries(lock.packages).filter(([key]) => key !== '');
for (const [key, entry] of entries) {
  ensure(typeof entry.integrity === 'string' && entry.integrity.length >= 16, `dependency without integrity: ${key}`);
}
const expected = entries
  .map(([key, entry]) => ({
    name: entry.name ?? key.split('node_modules/').pop(),
    version: entry.version,
    integrity: entry.integrity,
  }))
  .sort((a, b) => (a.name === b.name
    ? (a.version < b.version ? -1 : a.version > b.version ? 1 : 0)
    : (a.name < b.name ? -1 : 1)));

ensure(JSON.stringify(sbom.packages) === JSON.stringify(expected),
  'SBOM must match package-lock.json exactly (contents, order and integrity hashes)');
ensure(sbom.totals.packages === sbom.packages.length, 'totals must match the package count');

console.log(`SBOM guard PASS: ${sbom.packages.length} packages pinned with integrity, matching package-lock.json exactly`);
