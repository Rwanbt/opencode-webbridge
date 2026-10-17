import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('planning/compatibility.json');
const checker = resolve('scripts/check-compatibility.mjs');
function attempt(change?: (input: Record<string, any>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-compat-'));
  try {
    const compat = JSON.parse(readFileSync(source, 'utf8'));
    change?.(compat);
    const copy = join(dir, 'compatibility.json');
    writeFileSync(copy, JSON.stringify(compat));
    return spawnSync(process.execPath, [checker, copy], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('exact scoped compatibility evidence passes', () => {
  const result = attempt();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /desktop NOT PROVEN/);
});

test('desktop or CLI scope can never be inflated beyond proven evidence', () => {
  for (const modify of [
    (c: any) => { c.products.find((p: any) => p.id === 'opencode-desktop-electron').proven = true; },
    (c: any) => { c.products.find((p: any) => p.id === 'opencode-desktop-electron').scope = 'native-fixture'; },
    (c: any) => { c.products.find((p: any) => p.id === 'opencode-cli').version = '2.0.32'; },
    (c: any) => { c.products.find((p: any) => p.id === 'opencode-cli').scope = 'desktop'; },
    (c: any) => { c.products.find((p: any) => p.id === 'opencode-cli').evidence = ''; },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted an inflated compatibility claim');
    assert.match(result.stderr, /Compatibility guard/);
  }
});

test('windows coverage cannot claim the Linux full native fixture', () => {
  for (const modify of [
    (c: any) => { c.operatingSystems.find((o: any) => o.id === 'windows').proven = 'full-native-fixture'; },
    (c: any) => { c.operatingSystems.find((o: any) => o.id === 'linux').proven = 'bounded-rpc-only'; },
    (c: any) => { c.operatingSystems.push({ id: 'macos', proven: 'full-native-fixture', evidence: 'x' }); },
    (c: any) => { c.operatingSystems.find((o: any) => o.id === 'windows').evidence = ''; },
  ]) assert.notEqual(attempt(modify).status, 0);
});

test('commercial providers or browser writes can never activate through the matrix', () => {
  for (const modify of [
    (c: any) => { c.providers.operational = 5; },
    (c: any) => { c.providers.liveAutomationAuthorized = true; },
    (c: any) => { c.providers.commercial.shift(); },
    (c: any) => { c.browserWritesEnabled = true; },
    (c: any) => { c.observedAt = '2025-01-01'; },
    (c: any) => { c.reference.upstreamSHA = 'unpinned'; },
    (c: any) => { c.reference.patch = 'docs/patches/other.patch'; },
    (c: any) => { c.extra = true; },
  ]) assert.notEqual(attempt(modify).status, 0);
});
