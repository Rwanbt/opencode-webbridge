/** Standalone distributed fixture: no repo imports, browser interface, model, or effects. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export default {
  id: 'opencode.webbridge.rpc-package-fixture',
  async setup(ctx) {
    if (process.env.WEBBRIDGE_G81_TEST_ONLY !== '1') return;
    const secret = process.env.WEBBRIDGE_G81_SECRET;
    if (!/^[a-f0-9]{64}$/.test(secret ?? '')) throw new Error('isolated G81 capability missing');
    const seen = new Set();
    const contract = {
      id: 'webbridge-g81-package',
      methods: {
        challenge: {
          input: {
            type: 'object',
            properties: { secret: { type: 'string' }, scope: { type: 'string' }, nonce: { type: 'string' } },
            required: ['secret', 'scope', 'nonce'], additionalProperties: false,
          },
          output: {
            type: 'object',
            properties: { receipt: { type: 'string' } },
            required: ['receipt'], additionalProperties: false,
          },
        },
      },
      events: {},
    };
    const registration = await ctx.rpc.register(contract, {
      challenge: async ({ secret: provided, scope, nonce }) => {
        // Never accept a foreign fixture scope, unbounded input, or recycled nonce.
        if (scope !== 'g81-local-profile' || !/^[a-z0-9_-]{8,48}$/.test(nonce ?? '') ||
          typeof provided !== 'string' || !/^[a-f0-9]{64}$/.test(provided)) {
          throw new Error('fixture request denied');
        }
        if (!timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(secret, 'hex')) ||
          seen.has(nonce) || seen.size >= 16) throw new Error('fixture capability or replay denied');
        seen.add(nonce);
        // HMAC receipt proves the actual native RPC handler ran with ephemeral fixture authority.
        return { receipt: createHmac('sha256', secret).update(nonce).digest('hex') };
      },
    });
    return () => registration.dispose();
  },
};
