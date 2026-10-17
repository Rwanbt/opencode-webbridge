/**
 * Observe an EXISTING, already-authorized browser turn: no submit/click/navigate.
 * Native host must provide a real authority recheck, never a page-authored callback.
 */
import type { BrowserPort, TabClaim, TurnEvent } from './browser-port.js';
import type { RecoveryIdentity } from './session-recovery-coordinator.js';
import { DurableReadCheckpoint } from './durable-read-checkpoint.js';

export interface ReadObserverInput {
  readonly browser: Pick<BrowserPort, 'events'>;
  readonly claim: TabClaim;
  readonly identity: RecoveryIdentity;
  readonly checkpoint: DurableReadCheckpoint;
  readonly now: number;
  readonly maxAgeMs: number;
  readonly maxPolls?: number;
  readonly signal?: AbortSignal;
  /** Mandatory authoritative native permission check; NEVER accept this from a web page. */
  readonly authorizeRead?: () => Promise<void>;
  /** Must acknowledge each (turnID, seq) idempotently at its own durable sink. */
  readonly acknowledge: (event: TurnEvent) => Promise<void>;
}

/**
 * Acknowledges and durably checkpoints each validated frame before yielding it.
 * Does not issue new browser effects, even on missing/uncertain checkpoints.
 */
export async function* observeCheckpointedRead(input: ReadObserverInput): AsyncGenerator<TurnEvent> {
  const { browser, claim, identity, checkpoint, now, maxAgeMs, signal, acknowledge } = input;
  if (typeof input.authorizeRead !== 'function') throw new Error('native read authority unavailable');
  if (!browser || typeof browser.events !== 'function' || typeof acknowledge !== 'function')
    throw new Error('browser read port or durable sink unavailable');
  if (claim.sessionID !== identity.sessionID || claim.providerID !== identity.providerID ||
    claim.accountRef !== identity.accountRef || claim.tabID !== identity.tabID)
    throw new Error('browser read scope mismatch');
  const polls = input.maxPolls ?? 4;
  if (!Number.isSafeInteger(polls) || polls < 1 || polls > 16)
    throw new Error('read poll budget invalid');

  const plan = checkpoint.plan(identity, now, maxAgeMs);
  if (plan.action !== 'resume-stream') throw new Error(`checkpoint recovery denied: ${plan.action}`);
  let afterSeq = plan.fromFragmentIndex; // port sequence is 1-based; checkpoint indices are 0-based.
  let output = 0;
  const authorized = async () => {
    if (signal?.aborted) {
      checkpoint.abort();
      throw new Error('read abandoned: checkpoint tombstoned');
    }
    await input.authorizeRead!();
    if (signal?.aborted) {
      checkpoint.abort();
      throw new Error('read abandoned: checkpoint tombstoned');
    }
  };
  for (let poll = 0; poll < polls; poll++) {
    await authorized();
    const batch = await browser.events(claim, plan.turnID, afterSeq);
    await authorized(); // Revocation during the awaited Chromium/IPC read denies all output.
    if (!Array.isArray(batch) || batch.length > 64) throw new Error('invalid browser read batch');
    let expected = afterSeq + 1;
    let terminal = false;
    // Validate the ENTIRE untrusted batch before acknowledging even one frame.
    for (const event of batch) {
      if (!event || event.turnID !== plan.turnID || !Number.isSafeInteger(event.seq) ||
        event.seq !== expected++ || terminal) throw new Error('browser read frame identity/order denied');
      if (event.kind === 'text') {
        if (typeof event.value !== 'string' || !event.value || event.value.length > 4096)
          throw new Error('browser read frame text denied');
        output += event.value.length;
        if (output > 16_000) throw new Error('browser read text budget exceeded');
      } else if (event.kind === 'finished' || event.kind === 'cancelled') {
        terminal = true;
      } else throw new Error('unknown browser read frame');
    }
    for (const event of batch) {
      await authorized();
      try {
        await acknowledge(event);
        await authorized(); // Sink ACK can await; revoke-before-checkpoint must never yield.
      }
      catch {
        // Sink may have committed before the ACK was lost: never replay blindly.
        checkpoint.abort();
        throw new Error('read sink acknowledgement uncertain: abandoned without replay');
      }
      if (!checkpoint.admit(event.seq - 1).admit) throw new Error('checkpoint admission denied');
      afterSeq = event.seq;
      if (event.kind === 'finished') checkpoint.finish();
      if (event.kind === 'cancelled') checkpoint.abort();
      yield event;
      if (event.kind !== 'text') return;
    }
  }
  throw new Error('read timed out without terminal: checkpoint retained for a verified reconnect');
}
