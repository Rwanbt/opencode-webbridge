/** G170 public SDK provider/model proof in isolated local test profiles only.
 * This module is deliberately NOT loaded by the distributed root plugin. */
import { Model, Plugin, Provider } from '@opencode/plugin';
import type { G166TurnEvent } from './g166-chatgpt-manual-turn.js';

const PROVIDER = Provider.ID.make('webbridge-g170-offline-test');
const MODEL = Model.ID.make('webbridge-native-fixture');
const NO_GO = 'G170_PERSONAL_NO_GO: browser DOM has no authenticated per-turn finality or trusted OS/Desktop origin';

/** Never promote host-observed candidate text to native model completion. */
export function g170PersonalFinalityGate(events: readonly G166TurnEvent[]): never {
  if (!Array.isArray(events) || events.length > 512) throw new Error(NO_GO);
  // G166 only defines terminal:uncertain; neither operator consent nor a
  // candidate DOM message is an authenticated provider terminal receipt.
  throw new Error(NO_GO);
}

/** G170 test-only opt-in; path and transport cannot point at commercial web endpoints. */
export function g170OfflineConfig(env: NodeJS.ProcessEnv): {
  readonly endpoint: string; readonly token: string;
} | null {
  if (env.WEBBRIDGE_G170_OFFLINE_TEST !== '1') return null;
  if (env.WEBBRIDGE_G170_TEST_CONFIRMATION !== 'isolated-fixture-only')
    throw new Error('G170 isolated fixture confirmation required');
  const token = env.WEBBRIDGE_G170_FIXTURE_TOKEN ?? '';
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('G170 256-bit fixture token required');
  let url: URL;
  try { url = new URL(env.WEBBRIDGE_G170_FIXTURE_URL ?? ''); }
  catch { throw new Error('G170 local fixture URL missing'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !/^\d+$/.test(url.port) || url.port === '0' || url.pathname !== '/v1' ||
      url.username || url.password || url.search || url.hash)
    throw new Error('G170 explicit 127.0.0.1 /v1 local fixture URL required');
  return Object.freeze({ endpoint: url.origin + '/v1', token });
}

/** Test-only *actual* external plugin entrypoint for public OpenCode 2.0.32.
 * The commercial bridge is withheld: G166 cannot certify terminal finality.
 * Registered model is backed by a deterministic fixture with true [DONE] SSE,
 * distinct name and mandatory isolated flag. No login or user-owned browser. */
export default Plugin.define({
  id: 'opencode.webbridge.g170-native-probe',
  async setup(ctx) {
    const config = g170OfflineConfig(process.env);
    if (!config) return;
    const registration = await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(PROVIDER),
          name: 'WebBridge G170 OFFLINE SDK TEST ONLY', activation: 'enabled',
          package: '@opencode/ai/providers/openai-compatible',
          settings: { baseURL: config.endpoint, apiKey: config.token },
        },
        models: [{
          ...Model.Info.default(PROVIDER, MODEL),
          name: 'G170 synthetic local fixture (NOT ChatGPT)',
          capabilities: { tools: false, input: ['text'], output: ['text'] },
        }],
      });
    });
    return () => registration.dispose();
  },
});
