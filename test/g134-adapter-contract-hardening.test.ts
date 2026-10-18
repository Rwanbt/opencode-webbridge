// G134 — adversarial RED→GREEN matrix over validateAdapterContract() / isAdapterUsable().
// Fixture-only: no network, no provider site, no credential material. Nothing here
// enables a commercial model; the five providers stay disabled for production.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { WEB_PROVIDER_CATALOG } from '../src/catalog.js';
import { validateAdapterContract, isAdapterUsable } from '../src/core/adapter-contract.js';

const CAPS = {
  textInput: 'supported', textOutput: 'supported', streaming: 'supported',
  tools: 'unsupported', attachments: 'unknown', interruption: 'supported',
};
type AnyRecord = Record<string, unknown>;

function fixture(providerID: string, origin: string): AnyRecord {
  return {
    identity: { providerID, displayName: 'Fixture', origin },
    capabilities: { ...CAPS },
    policyDecision: 'restricted',
    approved: false,
  };
}

function reject(expected: string | RegExp, value: unknown): void {
  const result = validateAdapterContract(value);
  assert.equal(result.ok, false, `expected rejection ${String(expected)}`);
  if (result.ok) return;
  if (expected instanceof RegExp) assert.match(result.reason, expected);
  else assert.equal(result.reason, expected);
}

function accept(value: unknown): void {
  assert.deepEqual(validateAdapterContract(value), { ok: true });
}

for (const provider of WEB_PROVIDER_CATALOG) {
  const host = provider.origin.slice('https://'.length);

  test(`g134 ${provider.id}: only the exact catalog HTTPS origin is accepted`, () => {
    accept(fixture(provider.id, provider.origin));
    for (const lookalike of [
      `https://${host}.evil.example`, // suffix lookalike
      `https://sub.${host}`, // misleading subdomain
      `https://fake-${host.replace(/\./g, '-')}.example`,
      `https://${host.toUpperCase()}`,
      `${provider.origin}/`,
      `${provider.origin}/?redirect=1`,
      `${provider.origin}/#fragment`,
    ]) {
      reject('origin-mismatch', fixture(provider.id, lookalike));
    }
    reject('origin-credentials', fixture(provider.id, provider.origin.replace('https://', 'https://user:pass@')));
    reject('origin-port', fixture(provider.id, `${provider.origin}:8443`));
    reject('bad-origin', fixture(provider.id, 'http://chat.example'));
    reject('bad-origin', fixture(provider.id, 'not a url'));
    reject('bad-origin', fixture(provider.id, 'ftp://chat.qwen.ai'));
  });

  test(`g134 ${provider.id}: a disabled contract is structurally valid but never usable`, () => {
    const disabled = fixture(provider.id, provider.origin);
    accept(disabled);
    assert.equal(isAdapterUsable(disabled as never), false);
  });
}

test('g134: provider/origin cross mismatch and unknown providers are refused', () => {
  reject('origin-mismatch', fixture('qwen', 'https://chatgpt.com'));
  reject('origin-mismatch', fixture('chatgpt', 'https://chat.qwen.ai'));
  reject('unknown-provider', fixture('not-a-provider', 'https://chatgpt.com'));
});

test('g134: an opt-in without a permitted individual policy is incoherent', () => {
  const noAuthorization = fixture('chatgpt', 'https://chatgpt.com');
  noAuthorization.approved = true;
  reject('incoherent-approval', noAuthorization);

  const wrongPolicy = fixture('chatgpt', 'https://chatgpt.com');
  wrongPolicy.approved = true;
  wrongPolicy.policyDecision = 'restricted';
  wrongPolicy.commercialAuthorization = { status: 'permitted', evidenceRef: 'evidence_ref_1' };
  reject('incoherent-approval', wrongPolicy);
});

test('g134: policy decision is restricted to the four review states', () => {
  const invalid = fixture('qwen', 'https://chat.qwen.ai');
  invalid.policyDecision = 'allowed';
  reject('bad-policy-decision', invalid);
  for (const decision of ['restricted', 'unverified', 'written-authorization-required', 'permitted']) {
    const valid = fixture('qwen', 'https://chat.qwen.ai');
    valid.policyDecision = decision;
    accept(valid);
  }
});

test('g134: identity accepts exactly three data fields; secrets and hidden state are refused', () => {
  const withCookie = fixture('gemini', 'https://gemini.google.com');
  (withCookie.identity as AnyRecord).cookie = 'secret';
  reject('unexpected-field:cookie', withCookie);

  const withPermissions = fixture('gemini', 'https://gemini.google.com');
  (withPermissions.identity as AnyRecord).permissions = ['*'];
  reject('unexpected-field:permissions', withPermissions);

  const hidden = fixture('gemini', 'https://gemini.google.com');
  Object.defineProperty(hidden.identity as AnyRecord, 'sessionToken', { value: 't', enumerable: false });
  reject('unexpected-field:sessionToken', hidden);

  const withToJSON = fixture('gemini', 'https://gemini.google.com');
  (withToJSON.identity as AnyRecord).toJSON = () => ({ providerID: 'x' });
  reject('tojson-rejected', withToJSON);

  const symbolKey = fixture('gemini', 'https://gemini.google.com');
  (symbolKey.identity as never as Record<symbol, unknown>)[Symbol('secret')] = 'token';
  reject('symbol-key-rejected', symbolKey);

  let getterCalls = 0;
  const accessor = fixture('gemini', 'https://gemini.google.com');
  const accessorIdentity = accessor.identity as AnyRecord;
  delete accessorIdentity.origin;
  Object.defineProperty(accessorIdentity, 'origin', {
    enumerable: true,
    get() { getterCalls += 1; return 'https://gemini.google.com'; },
  });
  reject('accessor-rejected:origin', accessor);
  assert.equal(getterCalls, 0, 'hostile getter must not run');

  class Identity { providerID = 'gemini'; displayName = 'x'; origin = 'https://gemini.google.com'; }
  const classInstance = fixture('gemini', 'https://gemini.google.com');
  classInstance.identity = new Identity();
  reject('unexpected-prototype', classInstance);

  const nullProto = Object.create(null) as AnyRecord;
  nullProto.providerID = 'gemini'; nullProto.displayName = 'Fixture'; nullProto.origin = 'https://gemini.google.com';
  const withNullProto = fixture('gemini', 'https://gemini.google.com');
  withNullProto.identity = nullProto;
  accept(withNullProto); // a null prototype is the safest plain shape
});

test('g134: top-level contract rejects unknown fields, accessors, proxies and non-objects', () => {
  const extra = fixture('deepseek', 'https://chat.deepseek.com');
  extra.permissions = ['browser.write'];
  reject('unexpected-field:permissions', extra);

  reject('not-object', null);
  reject('not-object', 'contract');
  reject('not-object', [fixture('deepseek', 'https://chat.deepseek.com')]);

  const withToJSON = fixture('deepseek', 'https://chat.deepseek.com');
  withToJSON.toJSON = () => ({ ok: true });
  reject('tojson-rejected', withToJSON);

  let accessorCalls = 0;
  const accessor = fixture('deepseek', 'https://chat.deepseek.com');
  Object.defineProperty(accessor, 'approved', {
    enumerable: true,
    get() { accessorCalls += 1; return true; },
  });
  reject('accessor-rejected:approved', accessor);
  assert.equal(accessorCalls, 0);

  let trapCalls = 0;
  const proxy = new Proxy(fixture('deepseek', 'https://chat.deepseek.com'), {
    get(target, key, receiver) { trapCalls += 1; return Reflect.get(target, key, receiver); },
    getOwnPropertyDescriptor(target, key) { trapCalls += 1; return Reflect.getOwnPropertyDescriptor(target, key); },
    ownKeys(target) { trapCalls += 1; return Reflect.ownKeys(target); },
  });
  reject('proxy-rejected', proxy);
  assert.equal(trapCalls, 0, 'proxy traps must not run');
});

test('g134: capabilities must be exact, complete and getter-free', () => {
  const missing = fixture('mistral', 'https://chat.mistral.ai');
  delete (missing.capabilities as AnyRecord).streaming;
  reject('missing-field:streaming', missing);

  const extra = fixture('mistral', 'https://chat.mistral.ai');
  (extra.capabilities as AnyRecord).adminOverride = 'supported';
  reject('unexpected-field:adminOverride', extra);

  const invalidValue = fixture('mistral', 'https://chat.mistral.ai');
  (invalidValue.capabilities as AnyRecord).tools = 'maybe';
  reject('bad-capability:tools', invalidValue);

  let getterCalls = 0;
  const accessor = fixture('mistral', 'https://chat.mistral.ai');
  const caps = accessor.capabilities as AnyRecord;
  delete caps.tools;
  Object.defineProperty(caps, 'tools', {
    enumerable: true,
    get() { getterCalls += 1; return 'unsupported'; },
  });
  reject('accessor-rejected:tools', accessor);
  assert.equal(getterCalls, 0);
});

test('g134: declared, verified and commercial authorization stay distinct', () => {
  const verifiedNull = fixture('chatgpt', 'https://chatgpt.com');
  verifiedNull.verifiedCapabilities = null;
  accept(verifiedNull); // explicit "no proof yet" is valid but unusable

  const verifiedBad = fixture('chatgpt', 'https://chatgpt.com');
  verifiedBad.verifiedCapabilities = { ...CAPS, streaming: 'maybe' };
  reject('bad-verified-capability:streaming', verifiedBad);

  const incoherent = fixture('chatgpt', 'https://chatgpt.com');
  (incoherent.capabilities as AnyRecord).streaming = 'unknown';
  incoherent.verifiedCapabilities = { ...CAPS };
  reject('incoherent-verification:streaming', incoherent);

  const extraVerified = fixture('chatgpt', 'https://chatgpt.com');
  extraVerified.verifiedCapabilities = { ...CAPS, authority: 'native' };
  reject('unexpected-field:authority', extraVerified);

  const badStatus = fixture('chatgpt', 'https://chatgpt.com');
  badStatus.commercialAuthorization = { status: 'granted', evidenceRef: null };
  reject('bad-authorization-status', badStatus);

  const missingEvidence = fixture('chatgpt', 'https://chatgpt.com');
  missingEvidence.commercialAuthorization = { status: 'permitted', evidenceRef: null };
  reject('missing-authorization-evidence', missingEvidence);

  const badEvidence = fixture('chatgpt', 'https://chatgpt.com');
  badEvidence.commercialAuthorization = { status: 'permitted', evidenceRef: 'raw token with spaces' };
  reject('bad-authorization-evidence', badEvidence);

  const tokenSmuggle = fixture('chatgpt', 'https://chatgpt.com');
  tokenSmuggle.commercialAuthorization = { status: 'unverified', evidenceRef: null, token: 'secret' };
  reject('unexpected-field:token', tokenSmuggle);
});

test('g134: usable only with declared+verified capabilities, opt-in and individual policy status', () => {
  const full = fixture('qwen', 'https://chat.qwen.ai');
  full.approved = true;
  full.policyDecision = 'permitted';
  full.commercialAuthorization = { status: 'permitted', evidenceRef: 'maintainer_evidence_ref' };
  full.verifiedCapabilities = { ...CAPS };
  accept(full);
  assert.equal(isAdapterUsable(full as never), true, 'fully evidenced synthetic contract only');

  const noVerified = { ...full };
  delete (noVerified as AnyRecord).verifiedCapabilities;
  assert.equal(isAdapterUsable(noVerified as never), false);

  const unverifiedStreaming = { ...full, verifiedCapabilities: { ...CAPS, streaming: 'unknown' } };
  assert.equal(isAdapterUsable(unverifiedStreaming as never), false);

  const noAuthorization = { ...full };
  delete (noAuthorization as AnyRecord).commercialAuthorization;
  assert.equal(isAdapterUsable(noAuthorization as never), true,
    'a separate generic commercial grant is not an adapter prerequisite');

  const notPermitted = { ...full, commercialAuthorization: { status: 'unverified', evidenceRef: null } };
  assert.equal(isAdapterUsable(notPermitted as never), true,
    'legacy review metadata must not override a distinct permitted individual policy');

  const notApproved = { ...full, approved: false };
  assert.equal(isAdapterUsable(notApproved as never), false);

  const notPermittedPolicy = { ...full, policyDecision: 'restricted' };
  assert.equal(isAdapterUsable(notPermittedPolicy as never), false);

  let hostileCalls = 0;
  const hostile = { ...full };
  Object.defineProperty(hostile, 'approved', { get() { hostileCalls += 1; return true; } });
  assert.equal(isAdapterUsable(hostile as never), false);
  assert.equal(hostileCalls, 0, 'usability proof must not execute hostile getters');
});

test('g134: the five catalog providers stay disabled against the live policy file', () => {
  const policy = JSON.parse(readFileSync('planning/provider-policy-review.json', 'utf8')) as {
    commercialAutomationEnabled: boolean;
    providers: Array<{ id: string; decision: string; approved: boolean }>;
  };
  assert.equal(policy.commercialAutomationEnabled, false);
  assert.equal(policy.providers.length, 5);
  for (const entry of policy.providers) {
    const catalogEntry = WEB_PROVIDER_CATALOG.find((provider) => provider.id === entry.id);
    assert.ok(catalogEntry, `${entry.id} must exist in the catalog`);
    const contract = fixture(entry.id, catalogEntry.origin);
    contract.policyDecision = entry.decision;
    contract.approved = entry.approved;
    contract.commercialAuthorization = { status: entry.decision, evidenceRef: null };
    contract.verifiedCapabilities = null;
    accept(contract);
    assert.equal(isAdapterUsable(contract as never), false, `${entry.id} must stay unusable`);
  }
});
