import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('planning/sbom.json');
const checker = resolve('scripts/check-sbom.mjs');
function attempt(change?: (input: Record<string, any>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-sbom-'));
  try {
    const sbom = JSON.parse(readFileSync(source, 'utf8'));
    change?.(sbom);
    const copy = join(dir, 'sbom.json');
    writeFileSync(copy, JSON.stringify(sbom));
    return spawnSync(process.execPath, [checker, copy], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the committed SBOM matches package-lock.json exactly and passes', () => {
  const result = attempt();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SBOM guard PASS/);
  assert.match(result.stdout, /integrity/);
});

test('any drift from the lockfile is refused', () => {
  for (const modify of [
    (s: any) => { s.packages[0].version = '0.0.0-bogus'; },
    (s: any) => { s.packages.splice(5, 1); },
    (s: any) => { s.packages.push({ name: 'zzz-not-pinned', version: '1.0.0', integrity: 'sha512-x' }); },
    (s: any) => { s.packages[0].integrity = s.packages[0].integrity.replace(/.$/, 'A'); },
    (s: any) => { const [first] = s.packages.splice(0, 1); s.packages.splice(1, 0, first); },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted a drifted SBOM');
    assert.match(result.stderr, /SBOM guard/);
  }
});

test('schema, totals and observation date are locked', () => {
  for (const modify of [
    (s: any) => { s.observedAt = '2025-01-01'; },
    (s: any) => { s.totals.packages += 1; },
    (s: any) => { s.unexpected = true; },
    (s: any) => { s.packages[0].license = 'MIT'; },
  ]) assert.notEqual(attempt(modify).status, 0);
});
