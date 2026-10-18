import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseManualArgs } from '../bin/webbridge-manual-chatgpt.mjs';

const good = ['--owned-browser', '--endpoint', 'http://127.0.0.1:9222', '--tab',
  'TABABCDEF', '--session', 'SESSIONABC', '--turn', 'TURNABCDEF', '--journal', '.'];

test('G172 manual send requires explicit local browser, stable IDs, private journal selection', () => {
  assert.equal(parseManualArgs(good).tabID, 'TABABCDEF');
  for (const args of [
    good.filter((v) => v !== '--owned-browser'),
    [...good, '--tab', 'OTHERXXXX'],
    good.map((v) => v === 'http://127.0.0.1:9222' ? 'http://localhost:9222' : v),
    good.map((v) => v === 'TABABCDEF' ? 'a' : v),
    good.map((v) => v === 'http://127.0.0.1:9222' ? 'http://127.0.0.1:9222/?token=x' : v),
  ]) assert.throws(() => parseManualArgs(args), /refusal/);
});

test('G172 no stdin/stdout terminal denies unattended send before any CDP call', () => {
  const child = spawnSync(process.execPath, [join('bin', 'webbridge-manual-chatgpt.mjs'), ...good], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 5000, input: 'YES\nYES\nsecret\nYES\n',
  });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /interactive terminal required/);
  assert.doesNotMatch(child.stdout + child.stderr, /PRIVATE_TOKEN|G159_SEND_UNCERTAIN/);
});
