import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { proveActualEntrypoint } from './smoke-distributed-entrypoint.mjs';
import { createG152RootVerticalHost } from './g152-root-vertical-host.mjs';

if (process.platform !== 'linux') throw new Error('G152 real root Chrome only on hosted Linux');
const result = await proveActualEntrypoint({
  native: true, localFactory: createG152RootVerticalHost,
});
assert.equal(result.localOptIn?.fixtureNativeRpc, true);
assert.equal(result.localOptIn?.fixtureModelSSE, true);
assert.equal(result.fixtureModelRegistered, false, 'root must stay inert by default');
assert.equal(result.commercialOperational ?? 0, 0);
console.log('G152 true packaged root CLI local DOM/read/SSE integration PASS',
  JSON.stringify({ root: result.entrySHA256, actualRoot: result.rootPluginActive,
    defaultInert: !result.fixtureModelRegistered,
    localNativeModelAndRpc: result.localOptIn.fixtureNativeRpc,
    noCommercialProviders: true, patchedCoreInSameProcess: false,
    osTrustedDesktopPrincipal: false }));
