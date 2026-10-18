/** G152 real root .tgz fixture host, NOT a native OS/Desktop authority. */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createG149VerticalHost } from './g149-vertical-host.mjs';
import { listSessionIDs, verifyAfterRestart } from './g125-persisted-session.mjs';

const PROMPT = 'G99_LOCAL_PAGE_QUESTION: G152 actual installed root only, read-only.';
const EXPECTED = 'WEBBRIDGE_LOCAL_PAGE_OK:' + PROMPT;
const turnID = () => randomBytes(16).toString('hex');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const load = (name) => import(pathToFileURL(join(process.cwd(), 'dist/src/testing', name)).href);

// G158: OpenCode may request a second completion while the first is still
// processing durable tools. A fixed 5s poll is a race; share its terminal
// outcome, never start the browser/Git effect a second time.
export function createG158CompletionGate(timeoutMs = 45_000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000)
    throw new Error('G158 invalid first-turn wait budget');
  let settle;
  let finished = false;
  const completed = new Promise((resolve) => { settle = resolve; });
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    settle(ok);
  };
  return {
    succeed: () => finish(true),
    fail: () => finish(false),
    wait: () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('G158 first native model turn unresolved: reconcile')), timeoutMs);
      completed.then((ok) => {
        clearTimeout(timer);
        if (ok) resolve(); else reject(new Error('G158 first native model turn failed: no replay'));
      });
    }),
  };
}

/** Start polling the browser ONLY after native RPC has accepted its turn. */
export function createG158DeferredCompanion(run) {
  if (typeof run !== 'function') throw new Error('G158 companion callback missing');
  let started = false;
  return {
    get started() { return started; },
    start() {
      if (started) throw new Error('G158 companion already started: no double page submit');
      started = true;
      return Promise.resolve().then(run);
    },
  };
}

export async function createG152RootVerticalHost({
  temp, hostFactory = createG149VerticalHost,
}) {
  if (process.platform !== 'linux') throw new Error('G152 real DOM/root fixture only in Linux CI');
  const [{ openLocalChatPage }, { openLocalBrowserCompanion, submitLocalPageTurn },
    { OfflineSseResumeHost }] = await Promise.all([
    load('local-chat-page.js'),
    load('local-browser-companion.js'),
    import(pathToFileURL(join(process.cwd(),
      'dist/src/testing/offline-sse-resume-host.js')).href),
  ]);
  const page = await openLocalChatPage(), browser = await openLocalBrowserCompanion();
  const id = turnID();
  let ready, original, resumer, start, sessionID, prior, companion, published = 0, frames = 0;
  let modelEnded = false, modelStarted = false, errors = [];
  const completion = createG158CompletionGate();
  let stage = 'initialized', failedAt = 'none', companionState = 'not-started', gitAction = 'none';
  const mark = (name) => { stage = name; };
  const identity = {
    sessionID: '', providerID: 'qwen', accountRef: 'g152SyntheticOnly',
    tabID: 'g152LocalChrome', tabGeneration: 'g152TabGen',
    connectionID: 'g152NativeLoopback', connectionGeneration: 'g152ConnectionGen',
  };
  const key = randomBytes(32).toString('hex');
  const rpc = async (method, params = {}) => {
    if (!ready) throw new Error('G152 CLI native RPC unavailable');
    const response = await fetch(ready.base + '/api/rpc/webbridge-g99-page/' + method, {
      method: 'POST',
      headers: { ...ready.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {
        secret: ready.secret, scope: 'g99-local-page', ...params,
      } }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok) throw new Error('G152 native root RPC ' + method + ' denied HTTP ' + response.status);
    return (await response.json()).output;
  };
  const companionLaunch = createG158DeferredCompanion(async () => {
    companionState = 'polling';
    for (let i = 0; i < 180; i++) {
      const taken = await rpc('take');
      if (!taken.found) { await delay(40); continue; }
      companionState = 'page-submitting';
      assert.equal(taken.turnID, id);
      assert.equal(taken.prompt, PROMPT);
      const result = await submitLocalPageTurn(browser.page, page.url, taken.prompt,
        async (value, seq) => {
          const accepted = await rpc('progress', { turnID: id, seq, value });
          assert.equal(accepted.accepted, true);
        });
      assert.equal(result, EXPECTED);
      assert.equal((await rpc('complete', { turnID: id, response: result })).accepted, true);
      companionState = 'complete';
      return;
    }
    throw new Error('G158 accepted native turn never reached local DOM companion');
  });
  return {
    prompt: PROMPT,
    expected: EXPECTED,
    async beforeNativeTurn({ base, headers }) {
      mark('session.inventory');
      ready = { base, headers, secret: null };
      prior = new Set(await listSessionIDs(base, headers));
      // The G97 local package challenge secret is given by the harness only,
      // outside the DOM/model, and cannot be learned from page contents.
      ready.secret = this.env.WEBBRIDGE_G81_SECRET;
      mark('waiting-for-model-request');
    },
    respond: async (messages) => {
      assert.ok(JSON.stringify(messages).includes(PROMPT), 'not selected official root model turn');
      if (modelStarted) return (async function* () {
        await completion.wait();
        yield EXPECTED;
      })();
      modelStarted = true;
      return (async function* () {
        try {
        if (errors.length) throw new Error('G158 companion unavailable before model submit');
        mark('rpc.submit');
        assert.equal((await rpc('submit', { turnID: id, prompt: PROMPT })).accepted, true);
        companion = companionLaunch.start().catch((error) => {
          companionState = 'failed';
          errors.push(error);
          completion.fail();
        });
        mark('session.bound');
        const created = (await listSessionIDs(ready.base, ready.headers))
          .filter((item) => !prior.has(item));
        assert.equal(created.length, 1, 'G152 must derive exact native CLI session ID');
        if (errors.length) throw new Error('G158 companion unavailable before tool setup');
        sessionID = created[0];
        identity.sessionID = sessionID;
        mark('tool.host-setup');
        original = await hostFactory({ temp, sessionID, turnID: id,
          stage: (name) => { gitAction = name; mark('tool.' + name); } });
        mark('receipt.initializing');
        resumer = OfflineSseResumeHost.initialize(join(temp, 'g152-sse-' + id),
          identity, id, key, 1000);
        start = resumer.startCursor();
        let seq = 0, completed = false;
        for (let poll = 0; poll < 200 && !completed; poll++) {
          if (errors.length) throw new Error('G158 companion failed: refuse native stream');
          mark('rpc.progress-poll');
          const list = (await rpc('poll', { turnID: id, afterSeq: seq })).events;
          for (const event of list) {
            assert.equal(event.seq, seq + 1);
            if (errors.length) throw new Error('G158 companion failed: refuse native stream');
            if (seq === 0) {
              mark('tool.read-triple');
              await original.runReadonlyTool();
              if (errors.length) throw new Error('G158 companion failed: refuse native stream');
            }
            mark('receipt.commit');
            const signed = await resumer.acknowledgeRead(event, identity, 1000 + event.seq * 100);
            assert.equal(signed.status, 'committed');
            await original.acknowledge(event);
            seq++;
            if (event.kind === 'text') { published++; yield event.value; }
            else if (event.kind === 'finished') { completed = true; break; }
            else throw new Error('G152 unexpected cancelled local complete turn');
          }
          if (!completed) await delay(40);
        }
        assert.equal(seq, 4);
        assert.equal(published, 3);
        modelEnded = true;
        mark('model.finished');
        completion.succeed();
        } catch (error) {
          failedAt = stage;
          mark('model.failed');
          completion.fail();
          throw error;
        }
      })();
    },
    async afterNativeTurn() {
      assert.ok(companionLaunch.started && companion, 'G158 native submit never started companion');
      await companion;
      if (errors.length) throw errors[0];
      assert.ok(modelEnded && published === 3);
    },
    async afterShutdown({ executable, env, temp, headers, url }) {
      assert.ok(sessionID, 'G152 no actual OpenCode session ID');
      const session = await verifyAfterRestart({
        executable, env, temp, headers, url,
        sessionID, expected: EXPECTED, prompt: PROMPT,
      });
      assert.equal(session.persistedAfterRestart, true);
      const ack = await original.verifyRestored(['text','text','text','finished']);
      assert.equal(ack.readonlyToolConfirmed, true);
      resumer.close();
      resumer = OfflineSseResumeHost.open(join(temp, 'g152-sse-' + id),
        identity, id, key, 2400);
      const replay = resumer.replay(start, identity, 2500);
      assert.deepEqual(replay.map((part) => part.event.kind),
        ['text','text','text','finished']);
      assert.equal(replay.map((part) => part.event.value ?? '').join(''), EXPECTED);
      assert.deepEqual(resumer.replay(replay.at(-1).cursor, identity, 2501), []);
      assert.throws(() => resumer.replay(start, { ...identity, accountRef: 'forged' }, 2502),
        /denied|scope/);
      frames = replay.length;
    },
    get result() {
      return Object.freeze({ officialRootInstalled: true, nativeSessionIDBound: Boolean(sessionID),
        actualDOMFrames: published, recoveredDurableFrames: frames,
        replayOnlyData: true, osDesktopAuthority: false });
    },
    get diagnostic() {
      return Object.freeze({ stage, failedAt, companionState, companionStarted: companionLaunch.started, gitAction, modelStarted,
        modelEnded, receivedFrames: published, companionFailed: errors.length > 0 });
    },
    async close() {
      resumer?.close();
      await browser.close();
      await page.close();
    },
  };
}
