/** G125: ONLY Linux CI, official 2.0.32 + installed .tgz + real local Chromium + durable session. */
import { strict as assert } from 'node:assert';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCLI } from './smoke-packaged-model.mjs';
import { runPageProof, PROMPT } from './smoke-combined-page.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'node_modules/.bin/opencode');

export async function proveG125({ runPage = runPageProof, openPage, openBrowser, nativeBin = cli } = {}) {
  if (process.platform !== 'linux') throw new Error('G125 local Chromium must run only in Linux hosted CI');
  const version = await runCLI(nativeBin, ['--version'], process.env, root, { timeoutMs: 5000 });
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^opencode v2\.0\.32$/);
  const page = await openPage();
  try {
    const evidence = [];
    for (const scenario of ['tab-change', 'browser-disconnect']) {
      const browser = await openBrowser();
      try {
        const result = await runPage({ browser, localPage: page, nativeBin,
          adversarialScenario: scenario, persistSession: true });
        assert.equal(result.nativeChecks.length, 2);
        for (const check of result.nativeChecks) {
          assert.equal(check.model?.pageDOM, true);
          assert.equal(check.model?.rpcProgress, 3);
          assert.ok(check.model.sseFrames >= 3);
          assert.equal(check.model?.persistedAfterRestart, true);
          assert.equal(check.model?.assistantComplete, true);
        }
        assert.equal(result.adversarial?.uncertain, true);
        assert.equal(result.adversarial?.noForgedTerminal, true);
        assert.equal(result.adversarial?.sseDone, 0);
        assert.equal(result.adversarial?.persistedAfterRestart, true);
        assert.equal(result.adversarial?.assistantComplete, false);
        assert.equal(scenario === 'tab-change'
          ? result.adversarial?.nativeTabChange : result.adversarial?.nativePageClosed, true);
        evidence.push({ scenario, nativeModelRPCBrowserSSE: true, persistedAfterRestart: true,
          uncertaintyPersisted: true, outputFrames: result.nativeChecks.map((x) => x.model.sseFrames) });
      } finally { await browser.close(); }
    }
    return { cliVersion: '2.0.32', onlyInstalledTarball: true, localChromium: true,
      sessionPersistenceAfterHostRestart: true, cases: evidence };
  } finally { await page.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const dist = join(root, 'dist/src/testing');
    const { openLocalChatPage } = await import(pathToFileURL(join(dist, 'local-chat-page.js')).href);
    const { openLocalBrowserCompanion } = await import(pathToFileURL(join(dist, 'local-browser-companion.js')).href);
    const result = await proveG125({ openPage: openLocalChatPage, openBrowser: openLocalBrowserCompanion });
    console.log('G125 official 2.0.32 installed full local GUI-less integration PASS', JSON.stringify(result));
  } catch (error) {
    console.error('G125 official 2.0.32 integration FAILED', String(error));
    process.exitCode = 1;
  }
}
