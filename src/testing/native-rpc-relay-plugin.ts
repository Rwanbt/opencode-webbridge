import { Plugin } from '@opencode/plugin';
import type { TabClaim } from '../core/browser-port.js';
import { RpcRelayPort } from '../core/rpc-relay-port.js';
import { DurableRelayJournal } from '../core/durable-relay-journal.js';
import { BrowserRelayRPC } from './relay-rpc-contract.js';

type Input = { readonly secret: string; readonly sessionID: string; readonly tabID: string;
  readonly providerID: string; readonly accountRef: string; readonly turnID?: string;
  readonly prompt?: string; readonly response?: string; readonly chunk?: string; readonly afterSeq?: number };

const asInput = (raw: unknown): Input => raw as Input;
const asClaim = (input: Input): TabClaim => ({ sessionID: input.sessionID, tabID: input.tabID,
  providerID: input.providerID as TabClaim['providerID'], accountRef: input.accountRef });

/** Exposed only in an isolated OpenCode smoke profile with a synthetic account. */
export default Plugin.define({
  id: 'opencode.webbridge.rpc-fixture',
  async setup(ctx) {
    if (process.env.WEBBRIDGE_RELAY_ENABLE !== '1') return;
    const secret = process.env.WEBBRIDGE_RELAY_TOKEN;
    if (!secret) throw new Error('missing local test relay capability');
    const binding = { sessionID: 'fixture-session', tabID: 'fixture-tab',
      providerID: 'qwen' as const, accountRef: 'fixture-account' };
    const journalPath = process.env.WEBBRIDGE_RELAY_JOURNAL_DIR;
    if (!journalPath) throw new Error('test relay requires an isolated journal directory');
    const journal = DurableRelayJournal.open(journalPath, binding, secret);
    const relay = new RpcRelayPort(secret, journal);
    await relay.claim(binding);

    // All four methods are test-only. Each checks the entire binding and secret.
    const authorized = (raw: unknown) => {
      const input = asInput(raw);
      relay.check(input.secret, asClaim(input));
      return input;
    };
    let registration;
    try { registration = await ctx.rpc.register(BrowserRelayRPC, {
      submit: async (raw) => {
        const input = authorized(raw);
        await relay.submit(asClaim(input), { turnID: input.turnID!, prompt: input.prompt! });
        return { accepted: true };
      },
      cancel: async (raw) => {
        const input = authorized(raw);
        return { cancelled: await relay.cancel(asClaim(input), input.turnID!) };
      },
      take: async (raw) => {
        const input = asInput(raw);
        const item = relay.take(input.secret, asClaim(input));
        return item ? { found: true, ...item } : { found: false };
      },
      complete: async (raw) => {
        const input = asInput(raw);
        relay.complete(input.secret, asClaim(input), input.turnID!, input.response!);
        return { accepted: true };
      },
      progress: async (raw) => {
        const input = authorized(raw);
        relay.append(input.secret, asClaim(input), input.turnID!, input.chunk!);
        return { accepted: true };
      },
      observe: async (raw) => {
        const input = authorized(raw);
        const events = await relay.events(asClaim(input), input.turnID!, input.afterSeq!);
        return { events: [...events] };
      },
      result: async (raw) => {
        const input = authorized(raw);
        const events = await relay.events(asClaim(input), input.turnID!, 0);
        if (!events.some((event) => event.kind === 'finished')) return { finished: false };
        const response = events.filter((event) => event.kind === 'text')
          .map((event) => event.kind === 'text' ? event.value : '').join('');
        return { finished: true, response };
      },
    }); } catch (error) { journal.close(); throw error; }
    return async () => { await registration.dispose(); await relay.release(binding); journal.close(); };
  },
});
