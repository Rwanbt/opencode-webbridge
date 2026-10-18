/** User-attached, opt-in root capability in unmodified OpenCode 2.0.
 * Registration is only a reader; DO NOT register fake inference models. */
import { Schema } from 'effect';
import type { Plugin } from '@opencode/plugin';
import { ExplicitCdpReadBridge } from '../browser/explicit-cdp-read.js';
import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';

type Context = Plugin.Context;
const PROVIDERS = new Set<string>(WEB_PROVIDER_CATALOG.map((provider) => provider.id));
const fail = (reason: string): never => { throw new Error('G163 browser session refused: ' + reason); };
const Input = Schema.Struct({
  action: Schema.Literals(['list', 'headings', 'read']),
  provider: Schema.optional(Schema.String),
  tabID: Schema.optional(Schema.String),
});
const OPT = 'WEBBRIDGE_PERSONAL_CDP_READONLY';

export function g163ReadConfig(env: NodeJS.ProcessEnv) {
  if (env[OPT] !== '1') return null;
  if (env.WEBBRIDGE_PERSONAL_BROWSER_OWNED !== '1')
    return fail('declare ownership of the existing browser before enabling access');
  const endpoint = env.WEBBRIDGE_PERSONAL_CDP_ENDPOINT ?? '';
  let address: URL;
  try { address = new URL(endpoint); } catch { return fail('explicit CDP endpoint missing'); }
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' ||
      !/^\d+$/.test(address.port) || address.port === '0' ||
      address.pathname !== '/' || address.search || address.hash ||
      address.username || address.password) return fail('loopback-only CDP endpoint required');
  return Object.freeze({ endpoint: address.origin });
}

/** A native tool (not an advertised LLM) that works with REAL user-owned CDP tabs. */
export async function registerG163PersonalRead(ctx: Context, env: NodeJS.ProcessEnv) {
  const config = g163ReadConfig(env);
  if (!config) return;
  const registration = await ctx.tool.transform((editor) => editor.add({
    name: 'webbridge_browser',
    description: 'Opt-in real user-owned CDP tabs for five web providers: list, read-only headings, or selected assistant response. Requires OpenCode permission; no model send/inference.',
    input: Input,
    async execute(input, invocation) {
      if (input.action !== 'list' &&
          (!PROVIDERS.has(input.provider ?? '') || typeof input.tabID !== 'string' ||
           !/^[A-Za-z0-9_-]{4,128}$/.test(input.tabID)))
        return fail('explicit supported provider and selected CDP tab ID required');
      const authorize = async (action: string, resources: string[]) => {
        if (invocation.signal.aborted) return fail('caller cancelled');
        await ctx.permission.assert({
          sessionID: invocation.sessionID, agent: invocation.agent,
          action, resources, source: {
            type: 'tool', messageID: invocation.messageID, id: invocation.id,
          },
        });
        if (invocation.signal.aborted) return fail('caller cancelled');
      };
      const approve = async () => {
        await authorize('webbridge.cdp.attach', [config.endpoint]);
        return true;
      };
      const discovery = new ExplicitCdpReadBridge(config.endpoint, {
        userDeclaresBrowserOwnership: true, approve,
      });
      try {
        if (input.action === 'list') {
          await discovery.open();
          const tabs = await discovery.tabs();
          await authorize('webbridge.cdp.attach', [config.endpoint]);
          // URL path/query can contain personal conversation metadata: omit it.
          return { content: JSON.stringify(tabs.map((tab) => ({
            provider: tab.providerID, tabID: tab.tabID,
          }))), metadata: { inferenceEnabled: false, mode: 'read-only' } };
        }
        const provider = input.provider as WebProviderID, tabID = input.tabID!;
        if (input.action === 'headings') {
          await discovery.open();
          const selected = (await discovery.tabs()).find((tab) =>
            tab.providerID === provider && tab.tabID === tabID);
          if (!selected) return fail('exact provider/tab no longer attached');
          await authorize('webbridge.cdp.headings.read', [provider, tabID]);
          const headings = await discovery.headings(selected);
          await authorize('webbridge.cdp.headings.read', [provider, tabID]);
          return { content: JSON.stringify(headings), metadata: {
            provider, mode: 'read-only', inferenceEnabled: false,
          } };
        }
        if (provider === 'qwen') return fail('Qwen answer selectors unverified; discovery only');
        const read = async () => {
          await authorize('webbridge.cdp.assistant.read', [provider, tabID]);
          return true;
        };
        const consent = {
          userDeclaresBrowserOwnership: true as const,
          approve, allowAssistantText: read,
        };
        // The distributable root's *mandatory* CDP discovery/headings path uses
        // Node WebSocket, not Playwright. Load optional DOM readers only on read.
        const attachment = provider === 'chatgpt'
          ? await (await import('../browser/g157-chatgpt-cdp-observer.js')).G157ChatgptCdpObserver
            .attach(config.endpoint, tabID, consent)
          : await (await import('../providers/g160-other-provider-dom.js')).G160OtherProviderObserver
            .attach(config.endpoint, tabID, provider, consent);
        try {
          const answer = await attachment.sample();
          await authorize('webbridge.cdp.assistant.read', [provider, tabID]);
          if (!answer) return fail('no unambiguous selected assistant message');
          return {
            content: answer.text.slice(0, 16_000),
            metadata: { provider, messageKey: answer.messageKey,
              mode: 'read-only', inferenceEnabled: false },
          };
        } finally { await attachment.close(); }
      } finally { discovery.close(); }
    },
  }));
  return () => registration.dispose();
}
