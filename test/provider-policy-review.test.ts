import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function run(change?: (policy: any) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-policy-'));
  try {
    const policy = JSON.parse(readFileSync(resolve('planning/provider-policy-review.json'), 'utf8'));
    change?.(policy);
    const path = join(dir, 'policy.json');
    writeFileSync(path, JSON.stringify(policy));
    return spawnSync(process.execPath, [resolve('scripts/check-provider-policy.mjs'), path], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('all five official sources remain marked disabled pending verified authorization', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /0\/5 permitted/);
});

test('a changed terms status cannot implicitly activate commercial web automation', () => {
  for (const change of [
    (p: any) => { p.commercialAutomationEnabled = true; },
    (p: any) => { p.providers[0].approved = true; },
    (p: any) => { p.providers[1].decision = 'permitted'; },
    (p: any) => { p.providers[2].source = 'https://example.org/fake-terms'; },
    (p: any) => { p.providers[3].source = 'https://user:pass@qwen.ai/termsservice'; },
    (p: any) => { p.providers.pop(); },
    (p: any) => { p.providers[0].finding = ''; },
  ]) {
    const result = run(change);
    assert.notEqual(result.status, 0, 'unreviewed commercial access must fail closed');
    assert.match(result.stderr, /Provider policy gate/);
  }
});
