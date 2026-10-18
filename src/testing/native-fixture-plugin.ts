import { Model, Plugin, Provider } from '@opencode/plugin';
import { FIXTURE_MODEL } from './fixture-inference.js';

/**
 * Separate, opt-in plugin solely for checking the native provider runtime.
 * Not imported/exported by the production entrypoint and never intended for npm consumers.
 */
export default Plugin.define({
  id: 'opencode.webbridge.fixture',
  async setup(ctx) {
    if (process.env.WEBBRIDGE_FIXTURE_ENABLE !== '1') return;
    const rawURL = process.env.WEBBRIDGE_FIXTURE_URL;
    if (!rawURL) throw new Error('Fixture URL not supplied');
    const url = new URL(rawURL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/v1') {
      throw new Error('Fixture runtime must be an explicit 127.0.0.1 HTTP /v1 endpoint');
    }
    const token = process.env.WEBBRIDGE_FIXTURE_TOKEN;
    if (token !== undefined && !/^[a-f0-9]{64}$/.test(token)) {
      throw new Error('invalid local fixture token');
    }
    const providerID = Provider.ID.make('webbridge-fixture');
    const model = {
      ...Model.Info.default(providerID, Model.ID.make(FIXTURE_MODEL)),
      name: 'WebBridge deterministic local fixture (TEST ONLY)',
      capabilities: { tools: false, input: ['text'] as const, output: ['text'] as const },
    };
    const registration = await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: 'WebBridge Local Test Fixture',
          activation: 'enabled',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL: url.toString().replace(/\/$/, ''), ...(token ? { apiKey: token } : {}) },
        },
        models: [model],
      });
    });
    return () => registration.dispose();
  },
});
