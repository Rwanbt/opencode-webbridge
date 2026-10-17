import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('planning/progress.json');
const checker = resolve('scripts/check-progress.mjs');
function attempt(change?: (input: Record<string, any>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-progress-'));
  try {
    const progress = JSON.parse(readFileSync(source, 'utf8'));
    change?.(progress);
    const copy = join(dir, 'progress.json');
    writeFileSync(copy, JSON.stringify(progress));
    return spawnSync(process.execPath, [checker, copy], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('verified partial evidence and zero production acceptance pass', () => {
  const result = attempt();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /21 partial PRs; 0\/5 commercial, 0 accepted/);
});
test('partial CI cannot silently certify a commercial provider or enable writes', () => {
  for (const modify of [
    (p: any) => p.acceptance.commercialProvidersOperational.push('chatgpt'),
    (p: any) => p.acceptance.productionAcceptedStoryIDs.push('US-E5-02'),
    (p: any) => { p.acceptance.webbridgeWritesEnabled = true; },
    (p: any) => { p.acceptance.nativeDesktopElectronE2E = true; },
    (p: any) => { p.acceptance.atomicCoreChromiumRevocation = true; },
    (p: any) => { p.evidence[0].scope = 'production-approved'; },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted unsupported release claim');
    assert.match(result.stderr, /Progress guard/);
  }
});
test('fabricated SHA/checks or changed mapping cannot become evidence', () => {
  for (const modify of [
    (p: any) => { p.evidence[0].sha = 'not-a-sha'; },
    (p: any) => { p.evidence[0].checks = 42; },
    (p: any) => { p.evidence[1].pr = p.evidence[0].pr; },
    (p: any) => { p.backlog.totalIssues = 65; },
    (p: any) => { p.backlog.stories = 53; },
    (p: any) => { p.epicEvidence[0].acceptedStories = 1; },
    (p: any) => { p.epicEvidence[2].verifiedPartialPRs = [199]; },
    (p: any) => { p.epicEvidence[6].stories = 5; },
  ]) assert.notEqual(attempt(modify).status, 0);
});
