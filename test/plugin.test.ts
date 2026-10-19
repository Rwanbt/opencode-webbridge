import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import plugin from '../src/index.js';

type PluginContext = Parameters<typeof plugin.setup>[0];

test('V2 plugin module is importable and does not register fake models or tools', async () => {
  assert.equal(plugin.id, 'opencode.webbridge');
  // Until browser/runtime gate passes, setup may not touch any registries.
  // `options` is a documented public field of Plugin.Context (read so activation
  // can come from the configuration file, which the chat's long-lived server
  // re-reads at every start); every OTHER access must still fail.
  const context = new Proxy({ options: {} }, {
    get(target, key) {
      if (key === 'options') return (target as { options: unknown }).options;
      throw new Error(`unexpected plugin context access: ${String(key)}`);
    },
  });
  const result = await plugin.setup(context as PluginContext);
  assert.equal(result, undefined);
});
