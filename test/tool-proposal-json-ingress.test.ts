import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ingestToolProposalJSON } from '../src/core/tool-proposal-json-ingress.js';

const scope = Object.freeze({ sessionID: 'sess138', agentID: 'agent138', turnID: 'turn138',
  workspaceID: 'workspace138', callID: 'call138' });
const proposal = (action = 'file.read', args: object = { path: 'docs/readme.md' }) =>
  JSON.stringify({ version: 1, action, args, provenance: scope });
const rejected = (input: unknown, reason?: string) => {
  const result = ingestToolProposalJSON(input, scope);
  assert.equal(result.ok, false, typeof input === 'string' ? input.slice(0, 40) : 'non-string input');
  if (!result.ok && reason) assert.equal(result.reason, reason);
  assert.ok(Object.isFrozen(result));
};

test('G138 RED→GREEN: string and byte UTF-8 roundtrip, frozen G133 read-only scope', () => {
  for (const action of ['file.read', 'git.status', 'git.log', 'git.diff']) {
    const args = action === 'file.read' ? { path: 'src\\index.ts' } :
      action === 'git.diff' ? { path: 'src\\index.ts', staged: false } : { limit: 2 };
    for (const input of [proposal(action, args), Buffer.from(proposal(action, args)),
      Uint8Array.from(Buffer.from(proposal(action, args)))]) {
      const result = ingestToolProposalJSON(input, scope);
      assert.equal(result.ok, true, action);
      if (!result.ok) continue;
      assert.equal(result.proposal.action, action);
      assert.deepEqual(result.proposal.provenance, scope);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.proposal));
      assert.ok(Object.isFrozen(result.proposal.args));
      assert.ok(Object.isFrozen(result.proposal.provenance));
      if (action === 'file.read' || action === 'git.diff')
        assert.equal(result.proposal.args.path, 'src/index.ts');
    }
  }
});

test('G138 rejects duplicate keys at EVERY level, including Unicode-escaped alias', () => {
  const base = proposal();
  for (const raw of [
    base.replace('"version":1', '"version":1,"version":1'),
    base.replace('"action":"file.read"', '"action":"file.read","\\u0061ction":"git.log"'),
    base.replace('"path":"docs/readme.md"', '"path":"docs/readme.md","path":"elsewhere"'),
    base.replace('"sessionID":"sess138"', '"sessionID":"sess138","sessionID":"attacker"'),
    base.replace('"provenance":', '"provenance":{},"provenance":'),
  ]) rejected(raw, 'duplicate-key');
});

test('G138 rejects prototype pollution, inherited capability names, and hidden nested fields', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', '\\u005f_proto__']) {
    const raw = proposal().replace('"version":1', `"${key}":{"admin":true},"version":1`);
    rejected(raw, 'dangerous-key');
  }
  rejected(proposal().replace('"path":"docs/readme.md"',
    '"path":"docs/readme.md","command":"rm -rf ."'), 'bad-args');
  rejected(proposal().replace('"provenance":',
    '"permission":"webAuthorizesShell","provenance":'), 'not-object');
});

test('G138 exact JSON grammar: no trailing doc, comments, invalid number, null authority or bare control', () => {
  for (const raw of [
    proposal() + '{}', proposal() + ' true', proposal() + ';', proposal() + '\n{}',
    proposal().replace('"version":1', '"version":01'),
    proposal().replace('"version":1', '"version":1 // comment'),
    proposal().replace('"action":"file.read"', '"action":null'),
    proposal().replace('"path":"docs/readme.md"', '"path":null'),
    proposal().replace('"action":"file.read"', '"action":"file\n.read"'),
    '[1,2,3]', 'null', '{"a":true,}', '', '  ', '\ufeff' + proposal(),
  ]) assert.equal(ingestToolProposalJSON(raw, scope).ok, false);
});

test('G138 Unicode validation rejects lone surrogates, escaped control/bidi and invalid UTF-8', () => {
  for (const raw of [
    proposal().replace('docs/readme.md', '\\ud800'),
    proposal().replace('docs/readme.md', '\\udc00'),
    proposal().replace('docs/readme.md', '\\u0000'),
    proposal().replace('docs/readme.md', '\\u202e'),
    proposal().replace('docs/readme.md', '\\ufdd0'),
    proposal().replace('docs/readme.md', '\ud83f\udffe'),
    proposal().replace('docs/readme.md', '\ud800'),
    proposal().replace('docs/readme.md', '\udfff'),
  ]) rejected(raw, 'invalid-unicode');
  for (const bytes of [
    Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xed, 0xa0, 0x80),
    Uint8Array.of(0xf0, 0x9f, 0x98),
    Uint8Array.from([...Buffer.from(proposal()), 0xff]),
  ]) rejected(bytes, 'invalid-utf8');
});

test('G138 explicit bounded bytes, tokens, nesting and string length', () => {
  rejected(proposal('file.read', { path: 'x'.repeat(20000) }), 'oversized');
  rejected(proposal('file.read', { path: 'é'.repeat(8200) }), 'oversized');
  rejected(Uint8Array.of(...Array.from({ length: 17000 }, () => 0x20)), 'oversized');
  const deep = '['.repeat(18) + 'null' + ']'.repeat(18);
  rejected(deep, 'depth-limit');
  rejected('[' + Array.from({ length: 500 }, () => 'null').join(',') + ']', 'token-limit');
  rejected(proposal('file.read', { path: 'x'.repeat(9000) }), 'string-limit');
});

test('G138 never runs getters, toJSON, Symbol traps or Proxy traps of raw input', () => {
  let traps = 0;
  const evil = new Proxy({ toJSON() { traps++; throw new Error('toJSON'); } }, {
    get() { traps++; throw new Error('get'); },
    getPrototypeOf() { traps++; throw new Error('getPrototypeOf'); },
    ownKeys() { traps++; throw new Error('ownKeys'); },
  });
  const byteProxy = new Proxy(Uint8Array.from(Buffer.from(proposal())), {
    get() { traps++; throw new Error('byte get'); },
    getPrototypeOf() { traps++; throw new Error('byte prototype'); },
  });
  const getter = Object.defineProperty({}, 'payload', { get() { traps++; return proposal(); } });
  const bytesWithHostileAccessors = Uint8Array.from(Buffer.from(proposal()));
  for (const name of ['constructor', 'toJSON', Symbol.toStringTag])
    Object.defineProperty(bytesWithHostileAccessors, name, {
      get() { traps++; throw new Error('byte object getter must never run'); },
    });
  assert.equal(ingestToolProposalJSON(bytesWithHostileAccessors, scope).ok, true);
  for (const input of [evil, byteProxy, getter, new String(proposal()), null, 1, true, [], {}])
    rejected(input, 'input-type');
  assert.equal(traps, 0);
});

test('G138 malformed provenance, mixed actions/args, escaped executable and authority spoof denied', () => {
  rejected(proposal().replace('"sessionID":"sess138"', '"sessionID":"otherSession"'), 'scope-mismatch');
  rejected(proposal('terminal.exec', { command: 'echo secret' }), 'mutable-action');
  rejected(proposal('network.fetch', { url: 'https://example.org' }), 'unknown-action');
  rejected(proposal('git.status', { command: 'powershell', limit: 1 }), 'bad-args');
  rejected(proposal().replace('"action":"file.read"', '"action":"terminal\\u002eexec"'), 'mutable-action');
  rejected(proposal().replace('"action":"file.read"', '"action":"git.status"'), 'bad-args');
  rejected(proposal().replace('"workspaceID":"workspace138"', '"workspaceID":null'), 'bad-provenance');
});
