import { randomUUID } from 'node:crypto';
import type { BrowserPort, TabClaim } from '../core/browser-port.js';
import { exchangeBrowserTurn } from '../core/browser-exchange.js';

const MAX_PROMPT = 16_000;
const MAX_MESSAGES = 128;

/** The mock provider forwards the most recent text user message to BrowserPort. */
export function browserFixtureResponder(port: BrowserPort, binding: TabClaim) {
  return async (messages: readonly unknown[]): Promise<string> => {
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
      throw new Error('invalid message array');
    }
    // Inspect the LAST user request, even if it contains unsupported media.
    // Never fall back to an earlier, unrelated plaintext user turn.
    let user: Record<string, unknown> | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== 'object' || Object.getPrototypeOf(msg) !== Object.prototype) {
        throw new Error('unsupported message shape');
      }
      const role = Object.getOwnPropertyDescriptor(msg, 'role');
      if (!role || !role.enumerable || !Object.hasOwn(role, 'value') ||
        typeof role.value !== 'string') throw new Error('unsupported message role');
      if (role.value === 'user') { user = msg as Record<string, unknown>; break; }
    }
    if (!user || Reflect.ownKeys(user).some((key) =>
      typeof key !== 'string' || !['role', 'content', 'name'].includes(key))) {
      throw new Error('unsupported user content or attachments');
    }
    const content = Object.getOwnPropertyDescriptor(user, 'content');
    if (!content || !content.enumerable || !Object.hasOwn(content, 'value') ||
      typeof content.value !== 'string') throw new Error('unsupported user content or attachments');
    const prompt = content.value;
    if (!prompt || prompt.length > MAX_PROMPT) throw new Error('no bounded user prompt');
    // Identity is local to each new request. We do not retry failed/uncertain sends.
    const turnID = randomUUID().replaceAll('-', '');
    return exchangeBrowserTurn(port, binding, { turnID, prompt });
  };
}
