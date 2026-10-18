import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('planning/acceptance-matrix.json');
const checker = resolve('scripts/check-acceptance.mjs');
function attempt(change?: (input: Record<string, any>) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'webbridge-acceptance-'));
  try {
    const matrix = JSON.parse(readFileSync(source, 'utf8'));
    change?.(matrix);
    const copy = join(dir, 'acceptance-matrix.json');
    writeFileSync(copy, JSON.stringify(matrix));
    return spawnSync(process.execPath, [checker, copy], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the exact 54-story matrix with zero production acceptance passes', () => {
  const result = attempt();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /54 stories/);
  assert.match(result.stdout, /accepted 0\/54/);
});

test('the story set and order must match the backlog exactly', () => {
  for (const modify of [
    (m: any) => { m.stories.splice(10, 1); },
    (m: any) => { const [first] = m.stories.splice(0, 1); m.stories.splice(1, 0, first); },
    (m: any) => { m.stories[0].id = 'US-XX-99'; },
    (m: any) => { m.stories.push({ ...m.stories[0], id: 'US-E0-99' }); },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted a modified story set');
    assert.match(result.stderr, /Acceptance matrix/);
  }
});

test('a story can never claim a level without verifiable evidence', () => {
  for (const modify of [
    (m: any) => { m.stories[2].evidence = ''; },
    (m: any) => { m.stories[2].level = 'L9'; },
    (m: any) => { m.stories[0].unexpected = true; },
    (m: any) => { delete m.stories[0].evidence; },
  ]) assert.notEqual(attempt(modify).status, 0);
});

test('production acceptance is cross-checked against L3 entries and the progress guard', () => {
  for (const modify of [
    (m: any) => { m.stories[0].level = 'L3'; },
    (m: any) => { m.accepted.push('US-E0-01'); },
    (m: any) => {
      m.stories[0].level = 'L3';
      m.stories[0].evidence = 'claimed without a real authorized interaction';
      m.accepted = ['US-E0-01'];
    },
  ]) {
    const result = attempt(modify);
    assert.notEqual(result.status, 0, 'guard accepted unproven production acceptance');
  }
});

test('schema, observation date, levels and gate string are locked', () => {
  for (const modify of [
    (m: any) => { m.observedAt = '2025-01-01'; },
    (m: any) => { m.unexpected = 1; },
    (m: any) => { m.gate = ''; },
    (m: any) => { delete m.levels.L3; },
    (m: any) => { m.schemaVersion = 2; },
  ]) assert.notEqual(attempt(modify).status, 0);
});
