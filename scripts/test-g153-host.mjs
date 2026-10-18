import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createG153GitToolHost } from './g153-git-tool-host.mjs';

async function fixture(run) {
  const temp = await mkdtemp(join(tmpdir(), 'g153-host-'));
  const turnID = randomBytes(16).toString('hex');
  try { await run({ temp, sessionID: 'ses_g153_host', turnID }); }
  finally { await rm(temp, { force: true, recursive: true }); }
}
test('G153 unsupported Windows file/Git capability remains failclosed', {
  skip: process.platform === 'linux',
}, async () => fixture(async (opts) => {
  await assert.rejects(createG153GitToolHost(opts), /Linux/);
}));
test('G153 rejects forged official native session before Git setup', {
  skip: process.platform !== 'linux',
}, async () => fixture(async (opts) => {
  await assert.rejects(createG153GitToolHost({
    ...opts, sessionID: 'forged:\nroot',
  }), /native session identity/);
}));
test('G153 real temporary Git status/diff/log leaves original index untouched and denies restart replay', {
  skip: process.platform !== 'linux',
}, async () => fixture(async (opts) => {
  const host = await createG153GitToolHost(opts);
  try {
    await host.runReadonlyTool();
    await assert.rejects(host.runReadonlyTool(), /duplicate/);
    await host.acknowledge({ seq: 1, kind: 'text', turnID: opts.turnID,
      value: 'LOCAL_GIT_READ_ONLY' });
    await host.acknowledge({ seq: 2, kind: 'finished', turnID: opts.turnID });
    const done = await host.verifyRestored(['text', 'finished']);
    assert.equal(done.gitReadOperations, 3);
    assert.equal(done.reusedAfterRestart, false);
  } finally { host.close(); }
}));
