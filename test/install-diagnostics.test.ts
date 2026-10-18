import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { diagnoseInstall } from '../src/core/install-diagnostics.js';

const validManifest = { name: 'opencode-webbridge', version: '0.0.0', type: 'module', main: 'index.mjs' };
const validConfig = { enabled: true, providers: ['qwen'], maxConcurrency: 2, requestTimeoutMs: 30000, logLevel: 'error' };
const base = { manifest: validManifest, expectedName: 'opencode-webbridge', expectedVersion: '0.0.0' };

test('a valid installation reports version, config and no advisories', () => {
  const r = diagnoseInstall({ ...base, configRaw: validConfig });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.version, '0.0.0');
    assert.equal(r.config.logLevel, 'error');
    assert.deepEqual(r.advisories, []);
  }
});

test('absent or disabled config stays fail-closed with advisories, never enabled', () => {
  const absent = diagnoseInstall(base);
  assert.equal(absent.ok, true);
  if (absent.ok) {
    assert.equal(absent.config.enabled, false);
    assert.ok(absent.advisories.includes('config-absent'));
  }
  const disabled = diagnoseInstall({ ...base, configRaw: { ...validConfig, enabled: false, providers: [] } });
  assert.equal(disabled.ok, true);
  if (disabled.ok) {
    assert.equal(disabled.config.enabled, false);
    assert.ok(disabled.advisories.includes('config-disabled'));
    assert.ok(disabled.advisories.includes('providers-empty'));
  }
});

test('a broken manifest fails closed before anything else is evaluated', () => {
  const nullManifest = diagnoseInstall({ ...base, manifest: null, configRaw: { bogus: true } });
  assert.equal(nullManifest.ok, false);
  if (!nullManifest.ok) assert.deepEqual(nullManifest.findings, ['manifest-unreadable']);
  const wrongName = diagnoseInstall({ ...base, manifest: { ...validManifest, name: 'other' } });
  assert.equal(wrongName.ok, false);
  if (!wrongName.ok) assert.deepEqual(wrongName.findings, ['manifest-name-mismatch']);
  const badVersion = diagnoseInstall({ ...base, manifest: { ...validManifest, version: 'dev' } });
  assert.equal(badVersion.ok, false);
  if (!badVersion.ok) assert.deepEqual(badVersion.findings, ['manifest-version-invalid']);
  const mismatch = diagnoseInstall({ ...base, manifest: { ...validManifest, version: '9.9.9' } });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.deepEqual(mismatch.findings, ['version-mismatch']);
});

test('integrity is verified when expected, and never silently skipped', () => {
  const badExpected = diagnoseInstall({ ...base, expectedSha256: 'nope' });
  assert.equal(badExpected.ok, false);
  if (!badExpected.ok) assert.deepEqual(badExpected.findings, ['integrity-invalid']);
  const missingObserved = diagnoseInstall({ ...base, expectedSha256: 'a'.repeat(64) });
  assert.equal(missingObserved.ok, false);
  if (!missingObserved.ok) assert.deepEqual(missingObserved.findings, ['integrity-invalid']);
  const mismatched = diagnoseInstall({ ...base, expectedSha256: 'a'.repeat(64), observedSha256: 'b'.repeat(64) });
  assert.equal(mismatched.ok, false);
  if (!mismatched.ok) assert.deepEqual(mismatched.findings, ['integrity-mismatch']);
  const matched = diagnoseInstall({ ...base, expectedSha256: 'a'.repeat(64), observedSha256: 'a'.repeat(64) });
  assert.equal(matched.ok, true);
});

test('an invalid config is refused with the validator reason, never half-applied', () => {
  const r = diagnoseInstall({ ...base, configRaw: { ...validConfig, logLevel: 'verbose' } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0], /^config-invalid: /);
  }
});

test('the diagnose script reports PASS on a valid dir and FAIL on a broken one', () => {
  const script = resolve('scripts/diagnose-install.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-diag-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify(validManifest));
    const good = spawnSync(process.execPath, [script, dir, '0.0.0'], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /Install diagnostics PASS/);

    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...validManifest, version: '1.2.3' }));
    const bad = spawnSync(process.execPath, [script, dir, '0.0.0'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /version-mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
