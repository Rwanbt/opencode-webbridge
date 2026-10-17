import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { dirname, join, resolve } from 'node:path';
import { resolveNpmOpenCodeShim } from '../src/testing/native-cli-launcher.js';

test('Windows global npm CLI shim resolves directly to its own executable', () => {
  const shim = resolve('C:/Users/fixture/AppData/Roaming/npm/opencode.cmd');
  const executable = join(dirname(shim), 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
  assert.equal(resolveNpmOpenCodeShim(shim, (candidate) => candidate === executable), executable);
});

test('Windows local npm .bin shim resolves only the paired package executable', () => {
  const shim = resolve('C:/work/node_modules/.bin/opencode.cmd');
  const executable = resolve(dirname(shim), '..', '@opencode', 'cli', 'bin', 'opencode.exe');
  assert.equal(resolveNpmOpenCodeShim(shim, (candidate) => candidate === executable), executable);
  assert.throws(() => resolveNpmOpenCodeShim(shim, () => false), /native executable unavailable/);
});

test('a selected non-cmd native executable passes through unmodified', () => {
  assert.equal(resolveNpmOpenCodeShim('D:/OpenCode/opencode.exe', () => false), 'D:/OpenCode/opencode.exe');
});
