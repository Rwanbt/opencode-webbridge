/** Reviewed prompt bound for ONE browser turn, shared by the native transport
 *  and every provider send primitive so the limit is single-sourced.
 *
 *  Rationale (2026-10-19, measured live): the previous 4 000-character bound
 *  refused ordinary OpenCode turns. The harness sends its own context inside
 *  the same user message as the question, so a real session exceeded 4 000
 *  characters even with the prompt "ok" — the plugin refused before attaching,
 *  which made every real turn fail. The bound remains a bound (bounded browser
 *  work, anti-abuse) and is now aligned with the 16 000-character answer
 *  ceiling already enforced on every read. */
export const MAX_PROMPT_CHARS = 16_000;
