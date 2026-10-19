/** Activation from the plugin configuration: the mapping must be strict, because
 *  the options object is untrusted configuration, and the environment must still
 *  win so a one-off `--standalone` run can override the file. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { activationEnvFrom, effectiveEnv } from '../src/plugin-options.js';

test('the provider list becomes the activation variable, invalid entries dropped', () => {
  assert.equal(activationEnvFrom({ providers: ['chatgpt', 'deepseek'] }).WEBBRIDGE_NATIVE_WEB_MODELS,
    'chatgpt,deepseek');
  assert.equal(activationEnvFrom({ providers: ['chatgpt', 'NOT AN ID', '', 7, null] })
    .WEBBRIDGE_NATIVE_WEB_MODELS, 'chatgpt');
  assert.equal(activationEnvFrom({ providers: [] }).WEBBRIDGE_NATIVE_WEB_MODELS, undefined);
  assert.equal(activationEnvFrom({ providers: 'chatgpt' }).WEBBRIDGE_NATIVE_WEB_MODELS, undefined);
});

test('tab declarations must be an explicit loopback endpoint with a CDP target id', () => {
  const good = 'http://127.0.0.1:9222#CD3A975FFD71DF179DF1279C93465B71';
  assert.equal(activationEnvFrom({ tabs: { chatgpt: good } }).WEBBRIDGE_NATIVE_TAB_CHATGPT, good);
  for (const bad of [
    'https://chatgpt.com',                       // not loopback
    'http://127.0.0.1:9222',                     // no target id
    'http://evil.example:9222#TABABCDEFG',       // hostile origin
    'http://127.0.0.1:9222#abc',                 // id too short (min 4)
  ]) {
    assert.equal(activationEnvFrom({ tabs: { chatgpt: bad } }).WEBBRIDGE_NATIVE_TAB_CHATGPT, undefined,
      'refused: ' + bad);
  }
  assert.equal(activationEnvFrom({ tabs: { 'BAD ID': good } }).WEBBRIDGE_NATIVE_TAB_BAD_ID, undefined);
});

test('journal, fixture and personal toggles map onto their exact variables', () => {
  const env = activationEnvFrom({
    journalDir: 'C:/private/journal', fixture: true, readonlyTools: true,
    cdpReadonly: true, workspace: 'D:/App/repo',
  });
  assert.equal(env.WEBBRIDGE_NATIVE_JOURNAL_DIR, 'C:/private/journal');
  assert.equal(env.WEBBRIDGE_NATIVE_MODEL_FIXTURE, '1');
  assert.equal(env.WEBBRIDGE_PERSONAL_READONLY_TOOLS, '1');
  assert.equal(env.WEBBRIDGE_PERSONAL_CDP_READONLY, '1');
  assert.equal(env.WEBBRIDGE_PERSONAL_WORKSPACE, 'D:/App/repo');
  // Booleans only: a truthy string must not silently enable a personal surface.
  assert.equal(activationEnvFrom({ fixture: 'true' }).WEBBRIDGE_NATIVE_MODEL_FIXTURE, undefined);
  assert.equal(activationEnvFrom({ readonlyTools: 1 }).WEBBRIDGE_PERSONAL_READONLY_TOOLS, undefined);
});

test('non-object options are inert, and the real environment wins', () => {
  for (const value of [undefined, null, 'chatgpt', 42, ['chatgpt']])
    assert.deepEqual(activationEnvFrom(value), {});
  const merged = effectiveEnv({ providers: ['chatgpt'] },
    { WEBBRIDGE_NATIVE_WEB_MODELS: 'qwen', PATH: '/usr/bin' });
  assert.equal(merged.WEBBRIDGE_NATIVE_WEB_MODELS, 'qwen', 'a shell variable overrides the file');
  assert.equal(merged.PATH, '/usr/bin');
  assert.equal(effectiveEnv({ journalDir: '/j' }, {}).WEBBRIDGE_NATIVE_JOURNAL_DIR, '/j');
});
