import { randomUUID } from 'node:crypto';
import type { BrowserPort, TabClaim } from '../core/browser-port.js';
import { exchangeBrowserTurn } from '../core/browser-exchange.js';

const MAX_PROMPT = 16_000;

/** The mock provider forwards the most recent text user message to BrowserPort. */
export function browserFixtureResponder(port: BrowserPort, binding: TabClaim) {
  return async (messages: readonly unknown[]): Promise<string> => {
    if (!Array.isArray(messages)) throw new Error('invalid message array');
    // Inspect the LAST user request, even if it contains unsupported media.
    // Never fall back to an earlier, unrelated plaintext user turn.
    const user = [...messages].reverse().find((msg) =>
      msg !== null && typeof msg === 'object' && 'role' in msg && msg.role === 'user',
    ) as Record<string, unknown> | undefined;
    if (!user || Object.getPrototypeOf(user) !== Object.prototype ||
      Reflect.ownKeys(user).some((key) => !['role', 'content', 'name'].includes(String(key))) ||
      typeof user.content !== 'string') throw new Error('unsupported user content or attachments');
    const prompt = user.content;
    if (!prompt || prompt.length > MAX_PROMPT) throw new Error('no bounded user prompt');
    // Identity is local to each new request. We do not retry failed/uncertain sends.
    const turnID = randomUUID().replaceAll('-', '');
    return exchangeBrowserTurn(port, binding, { turnID, prompt });
  };
}
