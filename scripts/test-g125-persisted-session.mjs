import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { durableSession } from './g125-persisted-session.mjs';

const id = 'ses_g132_probe';
const prompt = 'G132_LOCAL_PROMPT';
const expected = 'WEBBRIDGE_LOCAL_PAGE_OK:' + prompt;

async function withOfficialSessionAPI(history, run) {
  let reads = 0;
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/session/' + id) return res.end(JSON.stringify({ data: { id } }));
    if (req.url?.startsWith('/api/session/' + id + '/message')) {
      return res.end(JSON.stringify({ data: history(reads++) }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`, () => reads);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const user = { type: 'user', text: prompt };
const assistant = { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: expected }] };

test('G132 native session read waits for an independently durable completed assistant', async () => {
  await withOfficialSessionAPI((read) => read < 2 ? [user] : [user, assistant], async (url, reads) => {
    const proof = await durableSession(url, {}, id, { expected, prompt }, { maxRetries: 3, intervalMs: 5 });
    assert.equal(proof.assistantComplete, true);
    assert.ok(reads() >= 3, 'must really observe persistent finish:stop after the transient history');
  });
});

test('G132 missing or wrong finished assistant never qualifies persisted history', async () => {
  for (const invalid of [[user], [user, { ...assistant, finish: 'tool-calls' }],
    [user, { ...assistant, content: [{ type: 'text', text: 'FORGED' }] }]]) {
    await withOfficialSessionAPI(() => invalid, async (url, reads) => {
      await assert.rejects(
        durableSession(url, {}, id, { expected, prompt }, { maxRetries: 2, intervalMs: 5 }),
        /finished native assistant text missing from persistent history/);
      assert.equal(reads(), 3, 'terminal absence must be checked repeatedly then refused');
    });
  }
});

test('G132 cancelled native turn still refuses fabricated completion', async () => {
  await withOfficialSessionAPI(() => [user, assistant], async (url) => {
    await assert.rejects(durableSession(url, {}, id, { prompt }),
      /uncertain browser turn incorrectly persisted completed assistant result/);
  });
});
