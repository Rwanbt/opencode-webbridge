import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** Explicit test-only output, never offered as a commercial provider/model. */
export const FIXTURE_MODEL = 'webbridge-native-fixture';
export const FIXTURE_REPLY = 'WEBBRIDGE_NATIVE_FIXTURE_OK';
const MAX_BODY_BYTES = 128 * 1024;

export interface FixtureServer {
  readonly baseURL: string;
  readonly requests: () => number;
  /** Number of body deltas emitted on the fixture SSE wire. */
  readonly streamFrames: () => number;
  readonly close: () => Promise<void>;
}

export interface FixtureServerOptions {
  /** Offline-only responder, used to prove native model ↔ BrowserPort handoff. */
  readonly respond?: (messages: readonly unknown[]) => Promise<string | AsyncIterable<string>> | AsyncIterable<string>;
  /** Optional secret for local integration testing. Never transmit it to a website. */
  readonly token?: string;
}

/** Loopback-only fake of the public OpenAI chat-completions wire shape. */
export async function openFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  if (options.token !== undefined && !/^[a-f0-9]{64}$/.test(options.token)) {
    throw new Error('fixture token must be a 256-bit lowercase hex secret');
  }
  let requests = 0;
  let streamFrames = 0;
  const server: Server = createServer((req, res) => {
    if (options.token !== undefined) {
      const provided = req.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'unauthorized fixture request' } }));
        return;
      }
    }
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: FIXTURE_MODEL, object: 'model' }] }));
      return;
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404); res.end(); return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      let body: { model?: unknown; messages?: unknown; stream?: unknown };
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body; }
      catch { res.writeHead(400); res.end(); return; }
      if (body.model !== FIXTURE_MODEL || !Array.isArray(body.messages) || body.messages.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'invalid fixture model or messages' } }));
        return;
      }
      requests += 1;
      const id = 'chatcmpl-webbridge-local-fixture';
      let reply: string | AsyncIterable<string> = FIXTURE_REPLY;
      try {
        if (options.respond) reply = await options.respond(body.messages);
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'fixture response unavailable' } }));
        return;
      }
      const progressive = typeof reply !== 'string' && reply !== null &&
        typeof reply[Symbol.asyncIterator] === 'function';
      if (typeof reply !== 'string' && !progressive) {
        res.writeHead(503); res.end(); return;
      }
      const frames = progressive ? reply as AsyncIterable<string> : (async function* () { yield reply as string; })();
      if (body.stream !== true) {
        let text = '';
        try {
          for await (const fragment of frames) {
            if (typeof fragment !== 'string' || text.length + fragment.length > 16_000)
              throw new Error('fixture response out of bounds');
            text += fragment;
          }
          if (!text) throw new Error('empty fixture response');
        } catch {
          res.writeHead(503); res.end(JSON.stringify({ error: { message: 'fixture response unavailable' } })); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id, object: 'chat.completion', created: 0, model: FIXTURE_MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
      let sent = 0;
      let length = 0;
      try {
        for await (const fragment of frames) {
          if (typeof fragment !== 'string' || !fragment || length + fragment.length > 16_000 || sent >= 64)
            throw new Error('fixture stream invalid');
          length += fragment.length;
          sent++;
          streamFrames++;
          send({ id, object: 'chat.completion.chunk', created: 0, model: FIXTURE_MODEL,
            choices: [{ index: 0, delta: { role: 'assistant', content: fragment }, finish_reason: null }] });
        }
        if (!sent) throw new Error('fixture stream empty');
        send({ id, object: 'chat.completion.chunk', created: 0, model: FIXTURE_MODEL,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
      } catch {
        // Once an SSE body started, reporting 200 + [DONE] would lie about an
        // uncertain browser stream. Terminate without success or content leak.
        res.destroy();
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) { server.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('invalid loopback listener'); }
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    streamFrames: () => streamFrames,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
