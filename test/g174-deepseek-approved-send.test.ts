/** G174 DeepSeek one-shot: the reviewed invariants must hold without a browser. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_PROMPT_CHARS } from '../src/core/prompt-bound.js';
import { g174ConsumeOnce, g174SendDeepseekOnce } from '../src/providers/g174-deepseek-approved-send.js';

const action = Object.freeze({
  sessionID: 'session_one', turnID: 'turn_one', tabID: 'ABCD1234', generation: 1,
  url: 'https://chat.deepseek.com/', providerID: 'deepseek' as const,
  promptSHA256: 'a'.repeat(64),
});

test('G174 refuses a request without explicit send authorization, before any browser work', async () => {
  await assert.rejects(
    g174SendDeepseekOnce({
      endpoint: 'http://127.0.0.1:9222', tabID: 'ABCD1234', sessionID: 'session_one',
      turnID: 'turn_one', prompt: 'hello', journalDir: tmpdir(),
      consent: { userDeclaresBrowserOwnership: true, approve: async () => true } as never,
    }),
    /invalid request or missing explicit send authorization/,
  );
});

test('G174 refuses an over-long or control-character prompt', async () => {
  const consent = {
    userDeclaresBrowserOwnership: true as const, approve: async () => true,
    approveSend: async () => true, isStillApproved: () => true,
  };
  for (const prompt of ['x'.repeat(MAX_PROMPT_CHARS + 1), 'bad\u0001prompt']) {
    await assert.rejects(
      g174SendDeepseekOnce({
        endpoint: 'http://127.0.0.1:9222', tabID: 'ABCD1234', sessionID: 'session_one',
        turnID: 'turn_one', prompt, journalDir: tmpdir(), consent,
      }),
      /invalid request or missing explicit send authorization/,
    );
  }
});

test('G174 one-shot consume is durable and never repeatable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g174-'));
  try {
    await g174ConsumeOnce(dir, 'turn_one', action);
    await assert.rejects(g174ConsumeOnce(dir, 'turn_one', action), /already consumed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('G174 one-shot refuses to consume into a missing journal target', async () => {
  await assert.rejects(g174ConsumeOnce(join(tmpdir(), 'g174-missing-dir-' + Date.now()), 'turn_one', action));
});
