import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { trackNativeChild } from '../src/testing/native-child-lifecycle.js';

test('child cleanup waits for close before removing an actively watched temp profile', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'webbridge-child-test-'));
  const watched = join(profile, 'watch.txt');
  await writeFile(watched, 'fixture only');
  // Child keeps its own file descriptor and output streams alive until killed.
  const code = `const fs=require('node:fs');fs.openSync(process.argv[1],'r');` +
    `process.stdout.write('READY');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', code, watched], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lifecycle = trackNativeChild(child);
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        once(child.stdout!, 'data'),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('fixture never started')), 3_000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let closed = false;
    child.once('close', () => { closed = true; });
    await lifecycle.stop();
    assert.equal(closed, true, 'stop must wait for child close before temp removal');
    await lifecycle.stop(); // close already occurred; must not wait for a missed event
    await rm(profile, { recursive: true, force: true });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});

test('cleanup succeeds when the child close event was already observed', async () => {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lifecycle = trackNativeChild(child);
  await once(child, 'close');
  await lifecycle.stop();
  assert.equal(child.exitCode, 0);
});
