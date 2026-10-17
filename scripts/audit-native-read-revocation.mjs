/** Security regression evidence for pinned OpenCode V2 patch: fails if the known gap disappears. */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const patch = readFileSync(new URL('../docs/patches/opencode-v2-4617210-browser-plugin-capability.patch', import.meta.url), 'utf8');
const slice = (from, to) => {
  const start = patch.indexOf(from);
  const end = patch.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `missing source boundaries: ${from}`);
  return patch.slice(start, end);
};
const core = slice('diff --git a/packages/core/src/plugin/browser.ts', 'diff --git a/packages/core/src/plugin/hooks.ts');
const desktop = slice('diff --git a/packages/gui-extensions/src/browser/pane.ts', 'diff --git a/packages/plugin-browser/src/connection.ts');
const connection = slice('diff --git a/packages/plugin-browser/src/connection.ts', 'diff --git a/packages/plugin-browser/src/index.ts');

// This verifies a real executable control-flow gap in the exact upstream patch, not a browser simulation.
assert.match(core, /authority\.consume\(ticket, binding\)/);
assert.match(core, /return bound\.read\(\)/);
assert.match(desktop, /rpc\["read\.commit"\]/);
assert.match(connection, /"read\.commit": \(input\)/);
const commit = connection.slice(connection.indexOf('+      "read.commit":'), connection.indexOf('       result: (input, call)'));
assert.match(commit, /read\.ticket === input\.ticket/);
assert.doesNotMatch(commit, /permission|authority|epoch|revision|lease/i,
  'Read commit now has a Core authority check; update the security verdict and test');
console.log('NO-GO reproduced: Core consumes lease before asynchronous Desktop commit; Desktop checks only local ticket, TTL and tab generation.');
