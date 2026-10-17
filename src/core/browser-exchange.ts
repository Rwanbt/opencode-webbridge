import type { BrowserPort, TabClaim, TurnRequest } from './browser-port.js';

const MAX_EVENTS = 64;
const MAX_TEXT = 16_000;

function interrupted(): Error {
  return new Error('browser turn interrupted: outcome uncertain; reconcile before retry');
}

/** Wake a waiting read on abort without assuming the underlying host effect stopped. */
function interruptible<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(interrupted());
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(interrupted()); };
    signal.addEventListener('abort', abort, { once: true });
    pending.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
    if (signal.aborted) abort();
  });
}

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

  // An uncertain send must be reconciled; automatic retry can duplicate a turn.
  if (signal?.aborted) throw interrupted();
  let dispatched = false;
  let finished = false;
  try {
    dispatched = true; // Burn before awaited host boundary: an ACK can be lost.
    await interruptible(port.submit(claim, request), signal);

    let seq = 0;
    let count = 0;
    let output = '';
    for (let poll = 0; poll < maxPolls; poll++) {
      if (signal?.aborted) throw interrupted();
      const events = await interruptible(port.events(claim, request.turnID, seq), signal);
      if (signal?.aborted) throw interrupted();
      if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new Error('invalid event batch');
      const fragments: string[] = [];
      let terminal = false;
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
          terminal = true;
        } else if (event.kind === 'cancelled') {
          throw new Error('remote turn cancelled');
        } else {
          throw new Error('unknown browser event');
        }
      }
      // Validate the entire frame batch before exposing any untrusted partial text.
      for (const fragment of fragments) {
        if (signal?.aborted) throw interrupted();
        yield fragment;
      }
      if (terminal) { finished = true; return; }
    }
    // No completion: explicit uncertain state. Never report partial text as final.
    throw new Error('browser turn uncertain: no terminal event; reconcile before retry');
  } finally {
    if (dispatched && !finished && signal?.aborted) {
      // A claimed/awaited turn might already have reached Chromium. Best effort
      // only: false/throw cannot certify reversal, and there is never a retry.
      void Promise.resolve().then(() => port.cancel(claim, request.turnID)).catch(() => {});
    }
  }
}

/** Legacy collector remains available for clients unable to consume async deltas. */
export async function exchangeBrowserTurn(
  port: BrowserPort, claim: TabClaim, request: TurnRequest, maxPolls = 4,
  signal?: AbortSignal,
): Promise<string> {
  let output = '';
  for await (const fragment of streamBrowserTurn(port, claim, request, maxPolls, signal)) output += fragment;
  return output;
}
