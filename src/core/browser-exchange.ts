import type { BrowserPort, TabClaim, TurnRequest } from './browser-port.js';

const MAX_EVENTS = 64;
const MAX_TEXT = 16_000;

/** Emit validated incremental browser text. Once submitted, no attempt is replayed. */
export async function* streamBrowserTurn(
  port: BrowserPort,
  claim: TabClaim,
  request: TurnRequest,
  maxPolls = 4,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 16) {
    throw new Error('poll limit out of bounds');
  }

  if (signal?.aborted) throw new Error('browser turn aborted before submit');
  // An uncertain send must be reconciled; automatic retry can duplicate a turn.
  await port.submit(claim, request);

  let seq = 0;
  let count = 0;
  let output = '';
  for (let poll = 0; poll < maxPolls; poll++) {
    if (signal?.aborted) throw new Error('browser turn aborted');
    const events = await port.events(claim, request.turnID, seq);
    if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new Error('invalid event batch');
    const fragments: string[] = [];
    let finished = false;
    for (const event of events) {
      count++;
      if (count > MAX_EVENTS || !event || event.turnID !== request.turnID ||
        !Number.isSafeInteger(event.seq) || event.seq !== seq + 1) {
        throw new Error('invalid event identity or ordering');
      }
      seq = event.seq;
      if (event.kind === 'text') {
        if (typeof event.value !== 'string' || output.length + event.value.length > MAX_TEXT) {
          throw new Error('response text out of bounds');
        }
        output += event.value;
        fragments.push(event.value);
      } else if (event.kind === 'finished') {
        if (event !== events.at(-1)) throw new Error('events after terminal state');
        if (!output) throw new Error('empty browser answer is not usable as model output');
        finished = true;
      } else if (event.kind === 'cancelled') {
        throw new Error('remote turn cancelled');
      } else {
        throw new Error('unknown browser event');
      }
    }
    // Validate the entire frame batch before exposing any untrusted partial text.
    // A fragment that arrives after abandonment must never be surfaced.
    if (signal?.aborted) throw new Error('browser turn aborted: late fragment rejected');
    for (const fragment of fragments) {
      if (signal?.aborted) throw new Error('browser turn aborted: late fragment rejected');
      yield fragment;
    }
    if (finished) return;
  }
  // No completion: explicit uncertain state. Never report a partial response as final.
  throw new Error('browser turn uncertain: no terminal event; reconcile before retry');
}

/** Legacy collector remains available for clients unable to consume async deltas. */
export async function exchangeBrowserTurn(
  port: BrowserPort, claim: TabClaim, request: TurnRequest, maxPolls = 4,
): Promise<string> {
  let output = '';
  for await (const fragment of streamBrowserTurn(port, claim, request, maxPolls)) output += fragment;
  return output;
}
