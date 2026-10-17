/** G125: independently query the official durable Session APIs across a native server restart. */
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function readAPI(url, headers, path) {
  const response = await fetch(url + path, { headers, signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`official session API ${path.split('/').slice(0, 3).join('/')} HTTP ${response.status}`);
  return response.json();
}

export async function listSessionIDs(url, headers) {
  const body = await readAPI(url, headers, '/api/session?limit=100');
  assert.ok(Array.isArray(body?.data), 'official session list must return data[]');
  return body.data.map((session) => session.id);
}

export async function durableSession(url, headers, sessionID, { expected, prompt },
  { maxRetries = 20, intervalMs = 100 } = {}) {
  assert.match(sessionID, /^ses_[a-zA-Z0-9_-]+$/);
  const details = await readAPI(url, headers, '/api/session/' + encodeURIComponent(sessionID));
  assert.equal(details?.data?.id, sessionID);
  const path = '/api/session/' + encodeURIComponent(sessionID) + '/message?limit=100';
  let messages = await readAPI(url, headers, path);
  assert.ok(Array.isArray(messages?.data), 'official message history missing');
  const text = (message) => (message.content ?? []).filter((part) => part.type === 'text')
    .map((part) => part.text).join('');
  assert.ok(messages.data.some((message) => message.type === 'user' &&
    typeof message.text === 'string' && message.text.includes(prompt)),
    'persisted native user prompt is missing');
  const completed = (list) => list.some((message) => message.type === 'assistant' &&
    message.finish === 'stop' && text(message).includes(expected));
  if (expected) {
    // CLI stdout may close just before its durable session commit. Observe an
    // ACTUAL finish:stop with exact persisted content, never infer it from SSE.
    for (let attempt = 0; !completed(messages.data) && attempt < maxRetries; attempt++) {
      await pause(intervalMs);
      messages = await readAPI(url, headers, path);
      assert.ok(Array.isArray(messages?.data), 'official message history missing');
    }
    assert.ok(completed(messages.data),
      'finished native assistant text missing from persistent history');
  } else {
    assert.ok(!messages.data.some((message) => message.type === 'assistant' &&
      message.finish === 'stop' && text(message).includes('WEBBRIDGE_LOCAL_PAGE_OK:')),
      'uncertain browser turn incorrectly persisted completed assistant result');
  }
  return { sessionID, messages: messages.data.length, assistantComplete: Boolean(expected) };
}

export async function verifyAfterRestart({ executable, env, temp, headers, url, sessionID, expected, prompt }) {
  const parsed = new URL(url);
  const child = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', parsed.port],
    { cwd: temp, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  for (const stream of [child.stderr, child.stdout]) {
    stream.on('data', (data) => { diagnostics = (diagnostics + data.toString()).slice(-1000); });
  }
  try {
    let loaded;
    for (let i = 0; i < 75 && child.exitCode === null; i++) {
      // Restart readiness is already independently polled here; avoid nesting
      // two wait loops or accepting an incomplete assistant history.
      try { loaded = await durableSession(url, headers, sessionID, { expected, prompt }, { maxRetries: 0 }); break; }
      catch { await pause(200); }
    }
    if (!loaded) throw new Error('G125 restarted native host failed to read persisted session: ' +
      diagnostics.replaceAll(env.OPENCODE_SERVER_PASSWORD ?? '', '[REDACTED]').slice(-250));
    return { persistedAfterRestart: true, ...loaded };
  } finally {
    if (child.exitCode === null) child.kill();
    await Promise.race([new Promise((done) => child.once('close', done)), pause(3000)]);
  }
}
