/**
 * G156: read-only DOM observation on a page the USER has already attached.
 * The host owns tab identity, permission and transport. This module never logs in,
 * sends prompts, navigates, fetches, intercepts requests, or accesses page secrets.
 */
import { readPlainFields } from '../core/adapter-contract.js';
import { assertOpaqueID, type TurnEvent } from '../core/browser-port.js';
import { WEB_PROVIDER_CATALOG, type WebProviderID } from '../catalog.js';

export interface G156Attachment {
  /** Current host-owned tab metadata (not page-authored JavaScript). */
  current(): Promise<unknown>;
  /** Read-only DOM evaluation in the previously attached page. */
  evaluate<R>(fn: () => R): Promise<R>;
  /** Host/Core's per-read authorization; called before and after every await. */
  authorizeRead(): Promise<void>;
}
export type G156Tab = { readonly tabID: string; readonly generation: string; readonly url: string };
export type G156Observation = {
  readonly messageKey: string;
  readonly text: string;
  readonly layout: 'legacy' | 'work';
  /** Provider-final evidence: the UI itself finalized THIS answer. */
  readonly finalized: boolean;
};
const MAX_TEXT = 16_000;

export function g156Origin(provider: WebProviderID, raw: string): string {
  const official = WEB_PROVIDER_CATALOG.find((p) => p.id === provider);
  if (!official || typeof raw !== 'string' || raw.length > 2048) throw new Error('unknown provider/origin');
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid attached URL'); }
  if (url.origin !== official.origin || url.protocol !== 'https:' ||
      url.username || url.password || url.port) throw new Error('attached origin denied');
  return url.origin;
}

function tabSnapshot(value: unknown): G156Tab {
  const result = readPlainFields(value, ['tabID', 'generation', 'url']);
  if (!result.ok) throw new Error(`attached tab metadata denied: ${result.reason}`);
  const tabID = result.fields.get('tabID'), generation = result.fields.get('generation');
  const url = result.fields.get('url');
  assertOpaqueID(tabID as string, 'tabID');
  assertOpaqueID(generation as string, 'generation');
  if (typeof url !== 'string') throw new Error('attached URL invalid');
  return Object.freeze({ tabID: tabID as string, generation: generation as string, url });
}

/** Runs IN the attached page, selecting answer bodies only, never prompt/hidden reasoning. */
export function g156ChatgptReadDOM(): G156Observation | null {
  const work = [...document.querySelectorAll(
    '[data-content-search-unit-key$=":assistant"],[data-chatgpt-search-unit-key$=":assistant"]',
  )];
  const legacy = [...document.querySelectorAll('article[data-turn="assistant"]')];
  const nodes = work.length ? work : legacy;
  if (!nodes.length || nodes.length > 256) return null;
  const root = nodes.at(-1)!;
  const layout = work.length ? 'work' : 'legacy';
  const key = layout === 'work'
    ? (root.getAttribute('data-content-search-unit-key') ??
        root.getAttribute('data-chatgpt-search-unit-key'))
    : (root.getAttribute('data-turn-id') ??
        root.querySelector('[data-message-id]')?.getAttribute('data-message-id'));
  if (!key || key.length > 256 || !/^[\w:.-]+$/.test(key)) return null;
  const texts = root.querySelectorAll(
    '[data-markdown-text-style="assistant-message"],.markdown',
  );
  if (texts.length !== 1) return null; // Ambiguous answer vs reasoning/tool blocks.
  const text = texts[0].textContent ?? '';
  if (!text || text.length > 16_000) return null;
  // Provider-final evidence, observed live (2026-10-18): the finalized answer's
  // own bar carries "Copier"/"Régénérer la réponse"/"Autres actions". The user
  // turn's controls ("Copier le message", "Modifier le message", "Partager le
  // prompt") deliberately do NOT match, so a streaming turn cannot borrow them.
  const labelOf = (el: Element): string =>
    el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.getAttribute('data-testid') ?? '';
  const FINAL = /^copier$|régénérer la réponse|autres actions|^partager$|lire à voix haute/i;
  const STOPPING = /stop|arr[êe]ter|abort|interrupt/i;
  let finalControls = 0;
  let bar: Element | null = root;
  for (let i = 0; i < 4 && bar; i++, bar = bar.parentElement) {
    const labels = new Set<string>();
    for (const b of bar.querySelectorAll('button,[role="button"]')) {
      const l = labelOf(b);
      if (l && FINAL.test(l)) labels.add(l);
    }
    finalControls = Math.max(finalControls, labels.size);
  }
  let generating = false;
  let seen = 0;
  for (const b of document.querySelectorAll('button,[role="button"],[data-testid*="stop" i]')) {
    if (++seen > 4000) break;
    if (STOPPING.test(labelOf(b))) { generating = true; break; }
  }
  const finalized = finalControls >= 2 && !generating;
  return { messageKey: key, layout, text, finalized };
}

export class G156ChatgptObserver {
  private readonly expected: G156Tab;
  private constructor(private readonly host: G156Attachment, expected: G156Tab) {
    this.expected = expected;
  }

  /** The provided host attachment must be bound independently to the user-selected tab. */
  static async attach(host: G156Attachment, provider: WebProviderID,
    expected: G156Tab): Promise<G156ChatgptObserver> {
    if (provider !== 'chatgpt') throw new Error('G156 DOM parser unavailable for this provider');
    const stable = tabSnapshot(expected);
    g156Origin(provider, stable.url);
    const observer = new G156ChatgptObserver(host, stable);
    await observer.check();
    return observer;
  }

  private async check(): Promise<void> {
    const current = tabSnapshot(await this.host.current());
    if (current.tabID !== this.expected.tabID ||
        current.generation !== this.expected.generation ||
        current.url !== this.expected.url) throw new Error('attached tab changed or revoked');
    g156Origin('chatgpt', current.url);
    await this.host.authorizeRead();
    const after = tabSnapshot(await this.host.current());
    if (after.tabID !== current.tabID || after.generation !== current.generation ||
        after.url !== current.url) throw new Error('attached tab changed during authorization');
  }

  async sample(): Promise<G156Observation | null> {
    await this.check();
    const raw = await this.host.evaluate(g156ChatgptReadDOM);
    await this.check(); // Revocation/navigation during evaluate refuses its private result.
    if (raw === null) return null;
    const parsed = readPlainFields(raw, ['messageKey', 'text', 'layout', 'finalized']);
    if (!parsed.ok) throw new Error('DOM snapshot malformed');
    const key = parsed.fields.get('messageKey'), text = parsed.fields.get('text');
    const layout = parsed.fields.get('layout');
    const finalized = parsed.fields.get('finalized');
    if (typeof key !== 'string' || !/^[\w:.-]{1,256}$/.test(key) ||
        typeof text !== 'string' || !text || text.length > MAX_TEXT ||
        typeof finalized !== 'boolean' ||
        (layout !== 'legacy' && layout !== 'work')) throw new Error('DOM snapshot invalid');
    return Object.freeze({ messageKey: key, text, layout, finalized });
  }

  /** Observes an EXPLICITLY selected answer; never auto-switches to another turn. */
  async *observe(turnID: string, messageKey: string, options: {
    readonly polls?: number; readonly pause?: () => Promise<void>;
  } = {}): AsyncGenerator<TurnEvent> {
    assertOpaqueID(turnID, 'turnID');
    if (!/^[\w:.-]{1,256}$/.test(messageKey)) throw new Error('invalid selected answer key');
    const polls = options.polls ?? 12;
    if (!Number.isSafeInteger(polls) || polls < 1 || polls > 32)
      throw new Error('DOM polling budget denied');
    let seen = '', seq = 0;
    for (let i = 0; i < polls; i++) {
      const snapshot = await this.sample();
      if (!snapshot || snapshot.messageKey !== messageKey)
        throw new Error('selected assistant message disappeared or changed');
      if (!snapshot.text.startsWith(seen)) throw new Error('DOM answer rewritten: uncertain');
      const pending = snapshot.text.slice(seen.length);
      for (let pos = 0; pos < pending.length; pos += 4096) {
        const value = pending.slice(pos, pos + 4096);
        yield Object.freeze({ kind: 'text' as const, turnID, seq: ++seq, value });
      }
      seen = snapshot.text;
      if (i < polls - 1) {
        if (options.pause) await options.pause();
        else await new Promise<void>((resolve) => setTimeout(resolve, 200));
      }
    }
    // No fabricated 'finished': DOM polling alone cannot attest provider finality.
  }
}
