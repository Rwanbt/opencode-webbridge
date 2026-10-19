/** A declared tab must be on a CONVERSATION **when an answer is observed**.
 *
 *  Measured across all five providers on 2026-10-19: the providers that answered
 *  had their declared tab on a conversation URL, while the ones that failed were
 *  on `/`, `/app` or `/chat`. On a home page the observation finds nothing and the
 *  plugin recorded "uncertain", which hid the real cause.
 *
 *  Scope, corrected by later evidence: this guard belongs to OBSERVATION, not to
 *  sending. DeepSeek's conversation titled "WEBBRIDGE-OK" was created by a send
 *  issued from the home page -- so a send from a landing page works and is the
 *  normal way to start a conversation. Refusing it there (the first version of
 *  this module did) blocked the very action that creates the conversation, and
 *  made Gemini's new-chat page impossible to use at all.
 *
 *  The rule is deliberately conservative: a path with fewer than two segments is
 *  a landing page. Every conversation URL seen so far has two or more
 *  (`/c/<id>`, `/work/<id>`, `/app/<id>`, `/a/chat/s/<id>`), so a working case is
 *  not refused. */

export interface TabPageState {
  readonly kind: 'conversation' | 'home';
  /** Human-readable cause, used verbatim in the refusal. */
  readonly detail: string;
}

export function tabPageState(url: string): TabPageState {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return { kind: 'home', detail: 'the declared tab URL cannot be parsed' };
  }
  const segments = pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return {
      kind: 'home',
      detail: 'the declared tab is on the provider home/new-chat page (' + pathname + ')',
    };
  }
  return { kind: 'conversation', detail: 'conversation path ' + pathname };
}

/** The refusal text, or null when the tab is on a conversation. Callers report
 *  rather than throw when they have a refusal channel, and throw otherwise. It
 *  names the provider and the action, so the failure is actionable instead of
 *  mysterious. */
export function conversationRequired(provider: string, url: string): string | null {
  const state = tabPageState(url);
  if (state.kind === 'conversation') return null;
  return provider + ': ' + state.detail
    + '; open a conversation in that tab, then declare it again';
}
