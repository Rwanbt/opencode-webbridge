/** One self-contained npm plugin: REAL native RPC + LOCAL FAKE model. Never commercial. */
import { createHmac, timingSafeEqual } from 'node:crypto';

const id = 'opencode.webbridge.g97-combined-test';
const provider = 'webbridge-fixture';
const model = 'webbridge-native-fixture';
const hexadecimal = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const localURL = (text) => {
  const url = new URL(text);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/v1' ||
    url.username || url.password || url.search || url.hash) {
    throw new Error('G97 model must use explicit 127.0.0.1 HTTP /v1 only');
  }
  return url.toString().replace(/\/$/, '');
};

export default {
  id,
  async setup(ctx) {
    if (process.env.WEBBRIDGE_G81_TEST_ONLY !== '1' ||
      process.env.WEBBRIDGE_FIXTURE_ENABLE !== '1') return;
    const secret = process.env.WEBBRIDGE_G81_SECRET;
    const token = process.env.WEBBRIDGE_FIXTURE_TOKEN;
    if (!hexadecimal(secret) || !hexadecimal(token)) throw new Error('G97 fixture authority missing');
    const baseURL = localURL(process.env.WEBBRIDGE_FIXTURE_URL ?? '');
    const seen = new Set();
    const contract = {
      id: 'webbridge-g81-package',
      methods: { challenge: {
        input: { type: 'object',
          properties: { secret: { type: 'string' }, scope: { type: 'string' }, nonce: { type: 'string' } },
          required: ['secret', 'scope', 'nonce'], additionalProperties: false },
        output: { type: 'object', properties: { receipt: { type: 'string' } },
          required: ['receipt'], additionalProperties: false },
      } },
      events: {},
    };
    const rpc = await ctx.rpc.register(contract, {
      challenge: async ({ secret: provided, scope, nonce }) => {
        if (scope !== 'g81-local-profile' || !/^[a-z0-9_-]{8,48}$/.test(nonce ?? '') ||
          !hexadecimal(provided) ||
          !timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(secret, 'hex')) ||
          seen.has(nonce) || seen.size >= 16) throw new Error('fixture authority or replay denied');
        seen.add(nonce);
        return { receipt: createHmac('sha256', secret).update(nonce).digest('hex') };
      },
    });
    // G99: one-turn *in-memory* local DOM relay, in this same installed package.
    // No browser driver, file IO or implicit permissions reside in the plugin.
    const identity = { secret: { type: 'string' }, scope: { type: 'string' } };
    const spec = (fields, required, output, outputRequired = Object.keys(output)) => ({
      input: { type: 'object', properties: { ...identity, ...fields },
        required: ['secret', 'scope', ...required], additionalProperties: false },
      output: { type: 'object', properties: output, required: outputRequired,
        additionalProperties: false },
    });
    let turn;
    const authorized = (input) => {
      if (input?.scope !== 'g99-local-page' || !hexadecimal(input.secret) ||
        !timingSafeEqual(Buffer.from(input.secret, 'hex'), Buffer.from(secret, 'hex')))
        throw new Error('G99 local page authority denied');
      return input;
    };
    let page;
    try {
      page = await ctx.rpc.register({
        id: 'webbridge-g99-page', events: {},
        methods: {
          submit: spec({ turnID: { type: 'string' }, prompt: { type: 'string' } },
            ['turnID', 'prompt'], { accepted: { type: 'boolean' } }),
          take: spec({}, [], { found: { type: 'boolean' }, turnID: { type: 'string' },
            prompt: { type: 'string' } }, ['found']),
          progress: spec({ turnID: { type: 'string' }, seq: { type: 'integer' },
            value: { type: 'string' } }, ['turnID', 'seq', 'value'], { accepted: { type: 'boolean' } }),
          complete: spec({ turnID: { type: 'string' }, response: { type: 'string' } },
            ['turnID', 'response'], { accepted: { type: 'boolean' } }),
          uncertain: spec({ turnID: { type: 'string' }, reason: { type: 'string',
            enum: ['tab-changed', 'browser-disconnected'] } }, ['turnID', 'reason'], { accepted: { type: 'boolean' } }),
          poll: spec({ turnID: { type: 'string' }, afterSeq: { type: 'integer' } },
            ['turnID', 'afterSeq'], { events: { type: 'array', items: {
              type: 'object', properties: { seq: { type: 'integer' }, turnID: { type: 'string' },
                kind: { type: 'string' }, value: { type: 'string' } },
              required: ['seq', 'turnID', 'kind'], additionalProperties: false } } }),
        },
      }, {
        submit: async (raw) => {
          const input = authorized(raw);
          if (turn || !/^[a-f0-9]{32}$/.test(input.turnID ?? '') ||
            typeof input.prompt !== 'string' || !input.prompt.startsWith('G99_LOCAL_PAGE_QUESTION:') ||
            input.prompt.length > 1000) throw new Error('G99 submit denied or duplicate');
          turn = { id: input.turnID, prompt: input.prompt, seq: 0, taken: false,
            finished: false, text: '', events: [] };
          return { accepted: true };
        },
        take: async (raw) => {
          authorized(raw);
          if (!turn || turn.taken) return { found: false };
          turn.taken = true;
          return { found: true, turnID: turn.id, prompt: turn.prompt };
        },
        progress: async (raw) => {
          const input = authorized(raw);
          if (!turn?.taken || turn.finished || turn.uncertain || turn.id !== input.turnID ||
            input.seq !== turn.seq + 1 || input.seq > 3 ||
            typeof input.value !== 'string' || !input.value || input.value.length > 4096 ||
            turn.text.length + input.value.length > 16000) throw new Error('G99 progress denied');
          turn.seq++;
          turn.text += input.value;
          turn.events.push({ seq: turn.seq, turnID: turn.id, kind: 'text', value: input.value });
          return { accepted: true };
        },
        complete: async (raw) => {
          const input = authorized(raw);
          if (!turn?.taken || turn.finished || turn.uncertain || turn.id !== input.turnID ||
            turn.seq !== 3 || input.response !== turn.text ||
            !turn.text.startsWith('WEBBRIDGE_LOCAL_PAGE_OK:')) throw new Error('G99 completion denied');
          turn.finished = true;
          turn.events.push({ seq: 4, turnID: turn.id, kind: 'finished' });
          return { accepted: true };
        },
        uncertain: async (raw) => {
          const input = authorized(raw);
          if (!turn?.taken || turn.finished || turn.uncertain || turn.id !== input.turnID ||
            !['tab-changed', 'browser-disconnected'].includes(input.reason))
            throw new Error('G100 uncertainty transition denied');
          turn.uncertain = true;
          turn.events.push({ seq: turn.seq + 1, turnID: turn.id, kind: 'cancelled' });
          return { accepted: true };
        },
        poll: async (raw) => {
          const input = authorized(raw);
          if (!turn || turn.id !== input.turnID ||
            !Number.isSafeInteger(input.afterSeq) || input.afterSeq < 0 ||
            input.afterSeq > 4) throw new Error('G99 poll denied');
          return { events: turn.events.filter((event) => event.seq > input.afterSeq) };
        },
      });
    } catch (error) { await rpc.dispose(); throw error; }
    let registration;
    try {
      registration = await ctx.provider.transform((editor) => editor.add({
        info: { id: provider, name: 'G97 local TEST ONLY', activation: 'enabled',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL, apiKey: token } },
        // Value-equivalent to pinned v2 Model.Info.default; no external SDK runtime import.
        models: [{ id: model, modelID: model, providerID: provider, name: 'G97 local TEST ONLY',
          capabilities: { tools: false, input: ['text'], output: ['text'] },
          variants: [], time: { released: 0 }, cost: [],
          status: 'active', enabled: true, limit: { context: 200000, output: 32000 } }],
      }));
    } catch (error) {
      await page.dispose();
      await rpc.dispose();
      throw error;
    }
    return async () => { await registration.dispose(); await page.dispose(); await rpc.dispose(); };
  },
};
