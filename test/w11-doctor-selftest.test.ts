/** Doctor/selftest contracts: the generated configuration and the answer parser
 *  are pure, and neither helper may invent a provider or a capability. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const doctor = await import(pathToFileURL(resolve('bin/webbridge-doctor.mjs')).href) as {
  readonly PROVIDERS: Array<{ id: string; origin: string }>;
  readonly tabEnv: (id: string) => string;
  readonly configLines: (input: {
    endpoint: string; journalDir: string;
    tabs: Array<{ id: string; tabID: string | null }>;
  }) => string[];
  readonly checkAttachable: (endpoint: string) => Promise<
    { readonly checked: false; readonly reason: string } | { readonly checked: true; readonly pages: number }>;
};
const selftest = await import(pathToFileURL(resolve('bin/webbridge-selftest.mjs')).href) as {
  readonly PROVIDER_IDS: readonly string[];
  readonly modelRef: (id: string) => string;
  readonly answerFrom: (stdout: string) => { answer: string; events: number };
};

test('the doctor covers exactly the five catalog providers with one origin each', () => {
  assert.deepEqual(doctor.PROVIDERS.map((p) => p.id).sort(),
    ['chatgpt', 'deepseek', 'gemini', 'mistral', 'qwen']);
  const origins = doctor.PROVIDERS.map((p) => p.origin);
  assert.equal(new Set(origins).size, 5);
  for (const provider of doctor.PROVIDERS) assert.match(provider.origin, /^https:\/\//);
});

test('the doctor emits only the declared tabs and a private journal line', () => {
  const lines = doctor.configLines({
    endpoint: 'http://127.0.0.1:9222', journalDir: '/private/journal',
    tabs: [{ id: 'chatgpt', tabID: 'TAB1' }, { id: 'deepseek', tabID: null }],
  });
  assert.deepEqual(lines, [
    'export WEBBRIDGE_NATIVE_WEB_MODELS=chatgpt',
    'export WEBBRIDGE_NATIVE_TAB_CHATGPT=http://127.0.0.1:9222#TAB1',
    'export WEBBRIDGE_NATIVE_JOURNAL_DIR=/private/journal',
  ]);
});

test('the selftest maps a provider to its explicit native model reference', () => {
  for (const id of selftest.PROVIDER_IDS) {
    assert.equal(selftest.modelRef(id), 'webbridge-' + id + '/' + id + '-web');
  }
  assert.deepEqual([...selftest.PROVIDER_IDS].sort(),
    ['chatgpt', 'deepseek', 'gemini', 'mistral', 'qwen']);
});

test('the selftest answer parser keeps only assistant text events', () => {
  const stdout = [
    'noise line that is not json',
    '{"type":"step_start","part":{"type":"step-start"}}',
    '{"type":"text","part":{"text":"2 + 2 "}}',
    '{"type":"text","part":{"text":"font 4."}}',
    '{"type":"error","error":{"message":"terminal uncertain"}}',
  ].join('\n');
  assert.deepEqual(selftest.answerFrom(stdout), { answer: '2 + 2 font 4.', events: 4 });
  assert.deepEqual(selftest.answerFrom(''), { answer: '', events: 0 });
});

test('the doctor reports an unattachable driver instead of staying silent', async () => {
  // Nothing is listening on port 1, so the check must report itself as not
  // performed with a reason, never as a silent success.
  const result = await doctor.checkAttachable('http://127.0.0.1:1');
  assert.equal(result.checked, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});
