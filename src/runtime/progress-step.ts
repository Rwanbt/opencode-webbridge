/** Pure progress state machine for the shared read-only transport (G175).
 *
 * Extracted so the correlation and finality invariants are testable WITHOUT a
 * browser on every platform: fragments are strictly append-only and monotonic,
 * a changed or disappeared selected message terminates, a rewritten answer
 * terminates, and no step can ever produce a "finished" verdict. The browser
 * loop keeps every live permission check; this module never reads a page. */

export interface ProgressSnapshot {
  readonly messageKey: string;
  readonly text: string;
}

export interface ProgressState {
  /** Full text already emitted for the selected message ('' before the first read). */
  readonly previous: string;
  /** Number of fragments emitted so far; candidate seq values strictly increase. */
  readonly seq: number;
  /** True once the selected message has been observed at least once. */
  readonly found: boolean;
}

export type ProgressTerminalReason = 'message-replaced' | 'answer-rewritten';

export type ProgressStep =
  | { readonly kind: 'fragments'; readonly state: ProgressState; readonly fragments: readonly string[] }
  | { readonly kind: 'terminal'; readonly reason: ProgressTerminalReason };

export const PROGRESS_CHUNK = 4096;

export const emptyProgressState: ProgressState = Object.freeze({ previous: '', seq: 0, found: false });

/** One sample → either strictly monotonic fragments or a hard terminal.
 * A snapshot of another message, a selected message that disappeared after
 * being observed, or a non-append-only rewrite can never be smoothed over. */
export function nextProgressStep(
  messageKey: string,
  state: ProgressState,
  snapshot: ProgressSnapshot | null,
  chunkSize: number = PROGRESS_CHUNK,
): ProgressStep {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1)
    throw new Error('progress chunk size must be a positive safe integer');
  if (snapshot !== null && snapshot.messageKey !== messageKey)
    return { kind: 'terminal', reason: 'message-replaced' };
  if (snapshot === null) {
    return state.found
      ? { kind: 'terminal', reason: 'message-replaced' }
      : { kind: 'fragments', state, fragments: [] };
  }
  if (!snapshot.text.startsWith(state.previous))
    return { kind: 'terminal', reason: 'answer-rewritten' };
  const remaining = snapshot.text.slice(state.previous.length);
  const fragments: string[] = [];
  for (let offset = 0; offset < remaining.length; offset += chunkSize)
    fragments.push(remaining.slice(offset, offset + chunkSize));
  return {
    kind: 'fragments',
    state: Object.freeze({ previous: snapshot.text, seq: state.seq + fragments.length, found: true }),
    fragments,
  };
}
