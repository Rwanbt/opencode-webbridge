import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import plugin from '../src/index.js';

type PluginContext = Parameters<typeof plugin.setup>[0];

test('V2 plugin module is importable and does not register fake models or tools', async () => {
  assert.equal(plugin.id, 'opencode.webbridge');
  // Until browser/runtime gate passes, setup may not touch any registries.
  const forbidden = new Proxy({}, {
    get(_target, key) { throw new Error(`unexpected plugin context access: ${String(key)}`); },
  });
  const result = await plugin.setup(forbidden as PluginContext);
  assert.equal(result, undefined);
});
