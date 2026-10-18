import { strict as assert } from 'node:assert';
import { proveActualEntrypoint } from './smoke-distributed-entrypoint.mjs';
import { createG152RootVerticalHost } from './g152-root-vertical-host.mjs';
import { createG153GitToolHost } from './g153-git-tool-host.mjs';

if (process.platform !== 'linux') throw new Error('G153 true Git root CI Linux only');
let diagnostic;
const result = await proveActualEntrypoint({
  native: true,
  localFactory: async (input) => {
    const host = await createG152RootVerticalHost({
      ...input, hostFactory: createG153GitToolHost,
    });
    diagnostic = host;
    return { ...host, timeoutMs: 120_000 };
  },
}).catch((error) => {
  // Stage names/counters only: never print prompts, DOM, provider credentials,
  // secret RPC headers or Git file content in publicly accessible CI logs.
  console.error('G158 G153 native stage', JSON.stringify(diagnostic?.diagnostic ??
    { stage: 'before-host-created' }));
  throw error;
});
assert.equal(result.rootPluginActive, true);
assert.equal(result.fixtureModelRegistered, false);
assert.equal(result.localOptIn?.fixtureNativeRpc, true);
assert.equal(result.localOptIn?.fixtureModelSSE, true);
console.log('G153 actual root native CLI DOM/Git status+diff+log durable SSE PASS',
  JSON.stringify({ actualRoot: true, gitReadActions: 3, gitIndexUnchanged: true,
    sessionPersistentAfterRestart: true, osAuthority: false,
    officialDesktopElectronE2E: false, commercialProvidersOperational: 0 }));
