import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { FIXTURE_MODEL, FIXTURE_REPLY, openFixtureServer } from '../src/testing/fixture-inference.js';

test('fixture inference is real loopback HTTP and exposes only a fake model', async () => {
  const server = await openFixtureServer();
  try {
    assert.match(server.baseURL, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    const models = await fetch(`${server.baseURL}/models`);
    assert.equal(models.status, 200);
    assert.equal((await models.json() as { data: { id: string }[] }).data[0].id, FIXTURE_MODEL);
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: FIXTURE_MODEL, messages: [{ role: 'user', content: 'fixture only' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { choices: { message: { content: string } }[] }).choices[0].message.content, FIXTURE_REPLY);
    assert.equal(server.requests(), 1);
  } finally { await server.close(); }
});

test('fixture streams bounded SSE and rejects unsupported model/route', async () => {
  const server = await openFixtureServer();
  try {
    const bad = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'chatgpt', messages: [] }),
    });
    assert.equal(bad.status, 400);
    const missing = await fetch(`${server.baseURL}/secret`);
    assert.equal(missing.status, 404);
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: FIXTURE_MODEL, messages: [{ role: 'user', content: 'test' }], stream: true }),
    });
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    const stream = await response.text();
    assert.match(stream, /WEBBRIDGE_NATIVE_FIXTURE_OK/);
    assert.match(stream, /data: \[DONE\]/);
    assert.equal(server.requests(), 1);
  } finally { await server.close(); }
});

test('fixture sends a first browser delta while terminal content is still pending', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const server = await openFixtureServer({ respond: async function* () {
    yield 'first-';
    await pending;
    yield 'second';
  } });
  try {
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: FIXTURE_MODEL, messages: [{ role: 'user', content: 'stream' }], stream: true }),
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /first-/);
    assert.doesNotMatch(new TextDecoder().decode(first.value), /\[DONE\]/);
    assert.equal(server.streamFrames(), 1);
    const next = reader.read();
    let complete = false;
    void next.then(() => { complete = true; });
    await Promise.resolve();
    assert.equal(complete, false);
    release();
    let remaining = new TextDecoder().decode((await next).value);
    assert.equal(server.streamFrames(), 2);
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      remaining += new TextDecoder().decode(part.value);
    }
    assert.match(remaining, /second/);
    assert.match(remaining, /\[DONE\]/);
  } finally { release(); await server.close(); }
});

test('failed browser stream never issues a false SSE [DONE] after partial output', async () => {
  const server = await openFixtureServer({ respond: async function* () {
    yield 'partial-but-unconfirmed';
    await new Promise((resolve) => setTimeout(resolve, 50));
    throw new Error('private browser failure must not be returned');
  } });
  try {
    const response = await fetch(`${server.baseURL}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: FIXTURE_MODEL, messages: [{ role: 'user', content: 'test' }], stream: true }),
    });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    assert.ok(reader);
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /partial-but-unconfirmed/);
    assert.doesNotMatch(new TextDecoder().decode(first.value), /\[DONE\]|private browser failure/);
    await assert.rejects(reader.read());
    assert.equal(server.streamFrames(), 1);
  } finally { await server.close(); }
});
