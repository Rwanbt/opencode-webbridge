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
  return {
    prompt: PROMPT,
    expected: EXPECTED,
    async beforeNativeTurn({ base, headers }) {
      ready = { base, headers, secret: null };
      prior = new Set(await listSessionIDs(base, headers));
      // The G97 local package challenge secret is given by the harness only,
      // outside the DOM/model, and cannot be learned from page contents.
      ready.secret = this.env.WEBBRIDGE_G81_SECRET;
      companion = (async () => {
        for (let i = 0; i < 180; i++) {
          const taken = await rpc('take');
          if (!taken.found) { await delay(40); continue; }
          assert.equal(taken.turnID, id);
          assert.equal(taken.prompt, PROMPT);
          const result = await submitLocalPageTurn(browser.page, page.url, taken.prompt,
            async (value, seq) => {
              const accepted = await rpc('progress', { turnID: id, seq, value });
              assert.equal(accepted.accepted, true);
            });
          assert.equal(result, EXPECTED);
          assert.equal((await rpc('complete', { turnID: id, response: result })).accepted, true);
          return;
        }
        throw new Error('G152 root RPC did not route prompt to real local DOM');
      })().catch((error) => { errors.push(error); });
    },
    respond: async (messages) => {
      assert.ok(JSON.stringify(messages).includes(PROMPT), 'not selected official root model turn');
      if (modelStarted) return (async function* () {
        // OpenCode may ask for a second inference completion on the same
        // official session. Re-serve already verified data ONLY, never replay
        // the page submit or filesystem/Git tool effect.
        for (let i = 0; i < 125 && !modelEnded; i++) await delay(40);
        if (!modelEnded) throw new Error('G152 duplicate inference before host commit');
        yield EXPECTED;
      })();
      modelStarted = true;
      return (async function* () {
        assert.equal((await rpc('submit', { turnID: id, prompt: PROMPT })).accepted, true);
        const created = (await listSessionIDs(ready.base, ready.headers))
          .filter((item) => !prior.has(item));
        assert.equal(created.length, 1, 'G152 must derive exact native CLI session ID');
        sessionID = created[0];
        identity.sessionID = sessionID;
        original = await hostFactory({ temp, sessionID, turnID: id });
        resumer = OfflineSseResumeHost.initialize(join(temp, 'g152-sse-' + id),
          identity, id, key, 1000);
        start = resumer.startCursor();
        let seq = 0, completed = false;
        for (let poll = 0; poll < 200 && !completed; poll++) {
          const list = (await rpc('poll', { turnID: id, afterSeq: seq })).events;
          for (const event of list) {
            assert.equal(event.seq, seq + 1);
            if (seq === 0) await original.runReadonlyTool();
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
      })();
    },
    async afterNativeTurn() {
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
    async close() {
      resumer?.close();
      await browser.close();
      await page.close();
    },
  };
}
