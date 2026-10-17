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
      await rpc.dispose();
      throw error;
    }
    return async () => { await registration.dispose(); await rpc.dispose(); };
  },
};
