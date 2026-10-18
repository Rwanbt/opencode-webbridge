import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import { isAdapterUsable, validateAdapterContract } from '../src/core/adapter-contract.js';
import { evaluateGate } from '../src/core/provider-gate.js';

const capabilities = Object.freeze({
  textInput: 'supported', textOutput: 'supported', streaming: 'supported',
  tools: 'unsupported', attachments: 'unknown', interruption: 'supported',
});

for (const provider of WEB_PROVIDER_CATALOG) {
  test(`personal ${provider.id}: opt-in with verified technical capabilities needs no generic commercial grant`, () => {
    const ready = {
      identity: { providerID: provider.id, displayName: provider.name, origin: provider.origin },
      capabilities: { ...capabilities },
      verifiedCapabilities: { ...capabilities },
      approved: true, policyDecision: 'permitted',
    };
    assert.deepEqual(validateAdapterContract(ready), { ok: true });
    assert.equal(isAdapterUsable(ready as never), true);
    assert.equal(isAdapterUsable({ ...ready, approved: false } as never), false);
    assert.equal(isAdapterUsable({ ...ready, verifiedCapabilities: null } as never), false);
    assert.equal(isAdapterUsable({ ...ready, policyDecision: 'restricted' } as never), false);
    const actualRuntime = evaluateGate({
      id: provider.id,
      policy: 'permitted', transport: 'unproven', browser: 'unproven',
      authenticated: false, consented: false,
      textInput: 'supported', textOutput: 'supported',
      tools: 'unsupported', streaming: 'supported',
    });
    assert.deepEqual(actualRuntime, { ready: false, reason: 'transport' },
      'reviewed personal choice does not fabricate a live authenticated web session');
  });
}
