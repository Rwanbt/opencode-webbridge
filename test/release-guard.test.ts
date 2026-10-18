import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('planning/release-posture.json');
const checker = resolve('scripts/check-release.mjs');
function attempt(change?: (input: Record<string, any>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-release-'));
  try {
    const posture = JSON.parse(readFileSync(source, 'utf8'));
    change?.(posture);
    const copy = join(dir, 'release-posture.json');
    writeFileSync(copy, JSON.stringify(posture));
    return spawnSync(process.execPath, [checker, copy], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the frozen NO-GO production posture passes and stays consistent with the gates', () => {
  const result = attempt();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NO-GO-PRODUCTION/);
  assert.match(result.stdout, /CLI experimental/);
});

test('the release decision can never be inflated in the posture', () => {
  for (const modify of [
    (p: any) => { p.decision = 'GO-PRODUCTION'; },
    (p: any) => { p.allowedClaims.desktop = true; },
    (p: any) => { p.allowedClaims.commercialProviders = 5; },
    (p: any) => { p.allowedClaims.browserWrites = true; },
    (p: any) => { p.allowedClaims.productionAccepted = true; },
    (p: any) => { p.allowedClaims.scope = 'Desktop and commercial release'; },
    (p: any) => { p.blockers = []; },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted an inflated release posture');
    assert.match(result.stderr, /Release guard/);
  }
});

test('every blocker must stay listed with an unresolved machine-checkable status', () => {
  for (const modify of [
    (p: any) => { p.blockers.pop(); },
    (p: any) => { p.blockers[0].status = 'RESOLVED'; },
    (p: any) => { p.blockers[0].evidence = ''; },
    (p: any) => { p.blockers.push({ id: 'zzz-extra', status: 'NOT-PROVEN', evidence: 'placeholder evidence' }); },
    (p: any) => { p.blockers[1].id = 'something-else'; },
  ]) assert.notEqual(attempt(modify).status, 0);
});

test('schema and observation date are locked', () => {
  for (const modify of [
    (p: any) => { p.observedAt = '2025-01-01'; },
    (p: any) => { p.unexpected = true; },
    (p: any) => { p.schemaVersion = 2; },
  ]) assert.notEqual(attempt(modify).status, 0);
});
