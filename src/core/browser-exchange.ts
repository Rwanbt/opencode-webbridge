import { assertOpaqueID, assertTextOnlyTurn, type BrowserPort, type TabClaim, type TurnRequest } from './browser-port.js';
import { WEB_PROVIDER_CATALOG } from '../catalog.js';

const MAX_EVENTS = 64;
const MAX_TEXT = 16_000;

/** Capture the trusted caller's exact owner before any asynchronous driver call. */
function snapshotClaim(claim: TabClaim): Readonly<TabClaim> {
  const keys = ['sessionID', 'providerID', 'tabID', 'accountRef'] as const;
  if (!claim || typeof claim !== 'object' || Object.getPrototypeOf(claim) !== Object.prototype ||
    Reflect.ownKeys(claim).length !== keys.length) throw new Error('invalid browser claim shape');
  const values: Record<string, string> = {};
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(claim, key);
    if (!field || field.enumerable !== true || !Object.hasOwn(field, 'value')) {
      throw new Error('browser claim must contain plain data fields');
    }
    assertOpaqueID(field.value, `claim ${key}`);
    values[key] = field.value;
  }
  if (!WEB_PROVIDER_CATALOG.some((provider) => provider.id === values.providerID)) {
    throw new Error('unregistered browser claim provider');
  }
  return Object.freeze(values) as unknown as Readonly<TabClaim>;
}

/**
 * Read one terminal response without ever resending the request. The browser's
 * output is untrusted even when the adapter implements the TypeScript contract.
 */
export async function exchangeBrowserTurn(
  port: BrowserPort,
  claim: TabClaim,
  request: TurnRequest,
  maxPolls = 4,
): Promise<string> {
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 16) {
    throw new Error('poll limit out of bounds');
  }

  // Reject unsupported media and unknown fields BEFORE any possible external effect.
  assertTextOnlyTurn(request);
  const binding = snapshotClaim(claim);
  const turn = Object.freeze({
    turnID: Object.getOwnPropertyDescriptor(request, 'turnID')!.value as string,
    prompt: Object.getOwnPropertyDescriptor(request, 'prompt')!.value as string,
  });
  // An uncertain send must be reconciled; automatic retry can duplicate a turn.
  await port.submit(binding, turn);

  let seq = 0;
  let count = 0;
  let output = '';
  for (let poll = 0; poll < maxPolls; poll++) {
    const events = await port.events(binding, turn.turnID, seq);
    if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new Error('invalid event batch');
    for (const event of events) {
      count++;
      if (count > MAX_EVENTS || !event || event.turnID !== turn.turnID ||
        !Number.isSafeInteger(event.seq) || event.seq !== seq + 1) {
        throw new Error('invalid event identity or ordering');
      }
      seq = event.seq;
      if (event.kind === 'text') {
        if (typeof event.value !== 'string' || output.length + event.value.length > MAX_TEXT) {
          throw new Error('response text out of bounds');
        }
        output += event.value;
      } else if (event.kind === 'finished') {
        if (event !== events.at(-1)) throw new Error('events after terminal state');
        if (!output) throw new Error('empty browser answer is not usable as model output');
        return output;
      } else if (event.kind === 'cancelled') {
        throw new Error('remote turn cancelled');
      } else {
        throw new Error('unknown browser event');
      }
    }
  }
  // No completion: explicit uncertain state. Never report a partial response as final.
  throw new Error('browser turn uncertain: no terminal event; reconcile before retry');
}
