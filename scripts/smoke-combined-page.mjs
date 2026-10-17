/** G99: one installed native model+RPC .tgz drives a genuine localhost Chromium DOM turn. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { descriptor } from './smoke-combined-package.mjs';
import { exerciseRPCPackage } from './offline-rpc-package.mjs';
import { runCLI } from './smoke-packaged-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist/src/testing');
const cli = join(root, 'node_modules/.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
export const PROMPT = 'G99_LOCAL_PAGE_QUESTION: answer using the local DOM, no tools.';
export const EXPECTED = 'WEBBRIDGE_LOCAL_PAGE_OK:' + PROMPT;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const fresh = () => randomBytes(32).toString('hex');

/** The two native CLI profile runs share ONE browser and local page server. */
export async function runPageProof({ browser, localPage, nativeBin = cli,
  adversarialScenario } = {}) {
  if (!existsSync(nativeBin)) throw new Error('pinned local official CLI missing');
  const { openFixtureServer } = await import(pathToFileURL(join(dist, 'fixture-inference.js')).href);
  const { submitLocalPageTurn } = await import(pathToFileURL(join(dist, 'local-browser-companion.js')).href);
  const pageBridge = {
    async prepare({ version, scenario }) {
      const token = fresh();
      let connection;
      let companion;
      let error;
      let cancelled = false;
      let active = true;
      let accepted = 0;
      let progress = 0;
      let finished = 0;
      let interrupted = false;
      const cancellation = new AbortController();
      let turnStarted;
      const chunks = [];
      const turnID = randomBytes(16).toString('hex');
      const rpc = async (method, input = {}) => {
        if (!connection) throw new Error('G99 native RPC not connected');
        const response = await fetch(connection.url + '/api/rpc/webbridge-g99-page/' + method, {
          method: 'POST', headers: connection.headers,
          body: JSON.stringify({ input: { secret: connection.secret, scope: 'g99-local-page', ...input } }),
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error('G99 native RPC ' + method + ' denied: ' + response.status);
        return (await response.json()).output;
      };
      const fake = await openFixtureServer({ token, respond: async (messages) => {
        if (!JSON.stringify(messages).includes(PROMPT)) throw new Error('unexpected local model prompt');
        turnStarted ??= (async () => {
          const submitted = await rpc('submit', { turnID, prompt: PROMPT });
          if (submitted?.accepted !== true) throw new Error('G99 native submit not accepted');
          accepted++;
          let afterSeq = 0;
          for (let count = 0; count < 160 && active; count++) {
            const events = (await rpc('poll', { turnID, afterSeq })).events;
            for (const event of events) {
              if (event.turnID !== turnID || event.seq !== afterSeq + 1) throw new Error('G99 RPC event sequence mismatch');
              afterSeq++;
              if (event.kind === 'text') chunks.push(event.value);
              else if (event.kind === 'finished') {
                if (chunks.length !== 3 || chunks.join('') !== EXPECTED)
                  throw new Error('G99 browser response incomplete');
                return;
              } else if (event.kind === 'cancelled' && scenario === 'tab-change' &&
                chunks.length === 1) {
                cancelled = true;
                return;
              } else throw new Error('G99 unexpected terminal state');
            }
            await delay(40);
          }
          throw new Error('G99 native progressive RPC stream timeout');
        })().catch((cause) => { error = cause; });
        return (async function* () {
          let cursor = 0;
          for (let spin = 0; spin < 160; spin++) {
            if (error) throw error;
            while (cursor < chunks.length) yield chunks[cursor++];
            if (cancelled) throw new Error('G100 cancelled native SSE without DONE');
            if (cursor === 3) {
              await turnStarted;
              if (error) throw error;
              return;
            }
            await delay(40);
          }
          throw new Error('G99 local SSE forward timeout');
        })();
      } });
      return {
        env: { WEBBRIDGE_FIXTURE_ENABLE: '1', WEBBRIDGE_FIXTURE_TOKEN: token,
          WEBBRIDGE_FIXTURE_URL: fake.baseURL },
        async verify({ url, headers, secret, executable, env, temp }) {
          connection = { url, headers, secret };
          const inventory = await fetch(url + '/api/plugin', { headers, signal: AbortSignal.timeout(3000) });
          if (!inventory.ok) throw new Error('native inventory unavailable');
          const plugins = (await inventory.json()).data?.filter((entry) => entry.id?.includes('webbridge')) ?? [];
          if (plugins.length !== 1 || plugins[0].id !== descriptor.id || plugins[0].state?.status !== 'active')
            throw new Error('G99 provider provenance not exclusively installed combined tarball');
          companion = (async () => {
            for (let spin = 0; spin < 200 && active; spin++) {
              const next = await rpc('take');
              if (!next.found) { await delay(40); continue; }
              if (next.turnID !== turnID || next.prompt !== PROMPT)
                throw new Error('G99 native queued prompt identity mismatch');
              const answer = await submitLocalPageTurn(browser.page, localPage.url, next.prompt,
                async (value, seq) => {
                  const acknowledgment = await rpc('progress', { turnID, value, seq });
                  if (acknowledgment.accepted !== true) throw new Error('G99 RPC progress rejected');
                  progress++;
                  if (scenario === 'tab-change' && seq === 1) {
                    // Confirm the *real* initial SSE fragment has left the
                    // loopback model before intentionally losing the tab.
                    for (let i = 0; i < 35 && fake.streamFrames() < 1; i++) await delay(40);
                    if (fake.streamFrames() < 1) throw new Error('G100 pre-fault SSE was never emitted');
                    // Genuine Chromium tab navigation after ONE accepted DOM fragment.
                    await browser.page.goto('about:blank', { waitUntil: 'load', timeout: 3000 });
                    if (browser.page.url() !== 'about:blank')
                      throw new Error('G100 tab never changed');
                    const uncertain = await rpc('uncertain', { turnID, reason: 'tab-changed' });
                    if (uncertain.accepted !== true) throw new Error('G100 native uncertainty not committed');
                    interrupted = true;
                    // The installed RPC MUST reject late writes and forged success.
                    for (const [method, input] of [
                      ['progress', { turnID, seq: 2, value: 'forged' }],
                      ['complete', { turnID, response: EXPECTED }],
                      ['submit', { turnID: randomBytes(16).toString('hex'), prompt: PROMPT }],
                      ['uncertain', { turnID, reason: 'tab-changed' }],
                    ]) {
                      let denied = false;
                      try { await rpc(method, input); } catch { denied = true; }
                      if (!denied) throw new Error('G100 post-tab-change ' + method + ' was accepted');
                    }
                    // Cancel CLI deliberately: never wait for a 50s natural hang.
                    cancellation.abort();
                    throw new Error('G100 injected tab-change uncertainty');
                  }
                });
              if (scenario === 'tab-change') throw new Error('G100 page unexpectedly completed after tab switch');
              if (answer !== EXPECTED) throw new Error('G99 real DOM answer mismatch');
              const done = await rpc('complete', { turnID, response: answer });
              if (done.accepted !== true) throw new Error('G99 RPC complete rejected');
              finished++;
              return;
            }
            throw new Error('G99 native turn never reached browser');
          })().catch((cause) => {
            if (scenario === 'tab-change' && interrupted &&
              String(cause).includes('G100 injected tab-change uncertainty')) return;
            error = cause;
            cancellation.abort();
          });
          const run = await runCLI(executable, ['run', '--server', url, '--model',
            'webbridge-fixture/webbridge-native-fixture', '--format', 'json', PROMPT],
          env, temp, { signal: cancellation.signal, timeoutMs: scenario === 'tab-change' ? 15_000 : 50_000 });
          await companion;
          if (scenario === 'tab-change') {
            const events = (await rpc('poll', { turnID, afterSeq: 0 })).events;
            if (error || !interrupted || !run.aborted || accepted !== 1 || progress !== 1 ||
              finished !== 0 || fake.requests() < 1 || fake.streamFrames() < 1 ||
              fake.completedStreams() !== 0 || run.stdout.includes(EXPECTED) ||
              events.length !== 2 || events[0]?.kind !== 'text' ||
              events[1]?.kind !== 'cancelled' || events.some((item) => item.kind === 'finished')) {
              throw new Error('G100 real tab-change fail-closed proof missing: ' + String(error?.message ?? '') +
                ', interrupted=' + interrupted + ', CLIaborted=' + run.aborted +
                ', RPCprogress=' + progress + ', SSE=' + fake.streamFrames() +
                ', SSEfinished=' + fake.completedStreams() + ', events=' +
                JSON.stringify(events.map((item) => item.kind)));
            }
            return { nativeTabChange: true, uncertain: true, noForgedTerminal: true,
              cliCancelled: true, browserDOMProgress: progress, partialSSE: fake.streamFrames(),
              sseDone: fake.completedStreams(), version };
          }
          if (error || run.code !== 0 || run.overflow || !run.stdout.includes(EXPECTED) ||
            accepted !== 1 || progress !== 3 || finished !== 1 ||
            fake.requests() < 1 || fake.streamFrames() < 3) {
            throw new Error('G99 DOM->native RPC->CLI SSE incomplete: ' + String(error?.message ?? '') +
              ', exit=' + run.code + ', queued=' + accepted + ', progress=' + progress +
              ', finished=' + finished + ', SSE=' + fake.streamFrames() +
              ', output=' + run.stdout.includes(EXPECTED));
          }
          return { pageDOM: true, installedCombined: true, rpcProgress: progress,
            localHttp: fake.requests(), sseFrames: fake.streamFrames(), version };
        },
        async close() { active = false; await fake.close(); },
      };
    },
  };
  return exerciseRPCPackage({ descriptor, nativeBin, modelBridge: pageBridge,
    adversarialScenario });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let page;
  let browser;
  try {
    if (process.platform === 'win32') throw new Error('G99 Chromium forbidden on low-RAM Windows; Linux CI only');
    const { openLocalChatPage } = await import(pathToFileURL(join(dist, 'local-chat-page.js')).href);
    const { openLocalBrowserCompanion, submitLocalPageTurn } =
      await import(pathToFileURL(join(dist, 'local-browser-companion.js')).href);
    page = await openLocalChatPage();
    browser = await openLocalBrowserCompanion();
    await assert.rejects(submitLocalPageTurn(browser.page, 'https://example.com/', PROMPT),
      /only explicit local test page URLs/);
    await assert.rejects(submitLocalPageTurn(browser.page, new URL('/admin', page.url).href, PROMPT),
      /only explicit local test page URLs/);
    const result = await runPageProof({ browser, localPage: page,
      adversarialScenario: 'tab-change' });
    assert.equal(result.nativeChecks.length, 2);
    assert.ok(result.nativeChecks.every((item) => item.model?.pageDOM && item.model?.rpcProgress === 3));
    assert.equal(result.adversarial?.nativeTabChange, true);
    assert.equal(result.adversarial?.noForgedTerminal, true);
    assert.equal(result.adversarial?.sseDone, 0);
    console.log('G100 combined native Chromium tab-change uncertainty PASS', JSON.stringify(result));
  } catch (error) {
    console.error('G99 LOCAL CHROMIUM proof FAIL:', String(error));
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await page?.close();
  }
}
