/** Consented browser-turn transport for the native models.
 *
 * Browser primitives (CDP attach/send/read) are injected: this module owns only
 * the turn semantics and the promises we refuse to break.
 *
 * Anti-replay: a model call retry must NEVER issue a second browser send for the
 * same (provider, model, prompt). A durable attempt record makes the retry
 * re-observe the SAME browser turn. A new deliberate prompt - i.e. the previous
 * attempt reached a terminal, or the reconcile window elapsed - is a new turn.
 *
 * Attribution: a fresh turn only adopts a candidate whose message key differs
 * from the baseline captured BEFORE the send, so the previous answer can never be
 * reported as this turn's. A reconciled attempt only ever observes the key it
 * recorded earlier; with no recorded key it refuses instead of guessing.
 *
 * Terminal honesty: DOM silence is never a completion. The terminal is
 * `complete` only when an explicit, separately verified completion proof is
 * injected; otherwise the turn ends `uncertain` with a precise reason. Nothing
 * here ever fabricates assistant text.
 */
import { createHash, randomBytes } from "node:crypto";
import type {
  NativeTerminalState,
  NativeTurnEvent,
  NativeTurnRequest,
  NativeTurnTransport,
} from "./turn-transport.js";

/** Latest assistant candidate observed in the selected tab (untrusted DOM data). */
export interface BrowserTurnObservation {
  readonly messageKey: string;
  readonly text: string;
}

/** The send was refused WITHOUT any UI effect: the attempt may be retried cleanly. */
export class BrowserTurnRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTurnRefusedError";
  }
}

/** The send may have landed (or its effect is unknown): never re-send this attempt. */
export class BrowserTurnUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTurnUncertainError";
  }
}

/** Consent-gated browser primitives for one attached, explicitly authorized tab. */
export interface BrowserTurnAttachment {
  /** Last assistant bubble present BEFORE any send; never adopted as our answer. */
  readonly baseline: BrowserTurnObservation | null;
  /** Exactly one UI submission for this turn, after the durable one-shot consume. */
  send(prompt: string, turnID: string): Promise<void>;
  /** Latest assistant candidate, or null while nothing is displayed yet. */
  sample(): Promise<BrowserTurnObservation | null>;
  /** Proven provider-final signal for a concrete observation. Absent: never complete. */
  readonly completion?: (observation: BrowserTurnObservation) => boolean;
  close(): Promise<void>;
}

export interface AttemptRecord {
  readonly turnID: string;
  readonly state: "inflight" | "complete" | "uncertain";
  readonly at: number;
  /** Candidate selected by this attempt; absent when none was observed yet. */
  readonly messageKey?: string;
}

/** Durable per-prompt attempt index. Implementations must persist atomically. */
export interface AttemptStore {
  read(promptKey: string): Promise<AttemptRecord | undefined>;
  write(promptKey: string, record: AttemptRecord): Promise<void>;
  /** Only for attempts refused before any UI effect (no browser turn happened). */
  discard(promptKey: string): Promise<void>;
}

export interface BrowserTurnTransportConfig {
  readonly providerID: string;
  readonly modelID: string;
  /** Attaches to the already-selected, explicitly authorized tab. */
  readonly attach: () => Promise<BrowserTurnAttachment>;
  readonly store: AttemptStore;
  readonly now?: () => number;
  readonly polls?: number;
  readonly intervalMs?: number;
  /** After this window an unfinished attempt stops reconciling (bounded, explicit). */
  readonly reconcileWindowMs?: number;
}

const promptKey = (providerID: string, modelID: string, prompt: string) => createHash("sha256")
  .update(providerID + "\0" + modelID + "\0" + prompt).digest("hex");
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("WebBridge browser turn: invalid bounded budget");
  return value;
};

export function createBrowserTurnTransport(config: BrowserTurnTransportConfig): NativeTurnTransport {
  const polls = bounded(config.polls, 24, 1, 64);
  const intervalMs = bounded(config.intervalMs, 250, 20, 2000);
  const reconcileWindowMs = bounded(config.reconcileWindowMs, 600_000, 1_000, 3_600_000);
  const now = config.now ?? (() => Date.now());

  return Object.freeze({
    async *stream(request: NativeTurnRequest): AsyncIterable<NativeTurnEvent> {
      if (!request || typeof request.prompt !== "string" || !request.prompt.trim())
        throw new Error("WebBridge browser turn: empty prompt refused");
      const key = promptKey(request.providerID, request.modelID, request.prompt);
      const existing = await config.store.read(key);
      const reconcilable = existing !== undefined && existing.state !== "complete"
        && now() - existing.at < reconcileWindowMs;
      const turnID = reconcilable ? existing.turnID : randomBytes(16).toString("hex");
      let selected: string | undefined = reconcilable ? existing.messageKey : undefined;
      let previous = "";
      // Persist BEFORE any UI effect: a crash leaves a durable attempt record.
      await config.store.write(key, reconcilable
        ? existing
        : { turnID, state: "inflight", at: now() });

      const settle = async (state: NativeTerminalState, reason: string) => {
        await config.store.write(key, {
          turnID, state: state === "complete" ? "complete" : "uncertain",
          at: now(), ...(selected === undefined ? {} : { messageKey: selected }),
        });
        return { kind: "terminal" as const, state, reason };
      };

      // Attach precedes every UI effect: a failed attach cannot have sent
      // anything. A fresh attempt is discarded so a later call may send again;
      // a reconciled attempt keeps its record (its earlier send may have landed).
      let browser: BrowserTurnAttachment;
      try {
        browser = await config.attach();
      } catch (error) {
        if (!reconcilable) await config.store.discard(key);
        throw error;
      }
      try {
        if (!reconcilable) {
          try {
            await browser.send(request.prompt, turnID);
          } catch (error) {
            if (error instanceof BrowserTurnUncertainError) {
              yield await settle("uncertain", "send-uncertain");
              return;
            }
            // Refused before any effect: forget the attempt so a later call may send.
            await config.store.discard(key);
            throw error;
          }
        } else if (selected === undefined) {
          // Nothing was ever observed for this attempt: guessing which bubble is
          // ours would be fabrication. Refuse and let the human reconcile.
          yield await settle("uncertain", "reconciled-attempt-without-observation");
          return;
        }

        for (let attempt = 0; attempt < polls; attempt += 1) {
          if (request.signal.aborted) {
            yield await settle("cancelled", "cancelled-before-terminal");
            return;
          }
          let answer: BrowserTurnObservation | null;
          try {
            answer = await browser.sample();
          } catch {
            yield await settle("uncertain", "read-revoked-or-document-changed");
            return;
          }
          if (answer === null) {
            if (selected !== undefined) {
              yield await settle("uncertain", "candidate-replaced-or-rewritten");
              return;
            }
          } else if (selected !== undefined && answer.messageKey !== selected) {
            yield await settle("uncertain", "candidate-replaced-or-rewritten");
            return;
          } else if (selected === undefined) {
            // A fresh turn must not adopt the answer that predates its send.
            if (reconcilable || answer.messageKey === browser.baseline?.messageKey) {
              // Reconciled attempts always carry a key; the baseline bubble is not ours.
            } else {
              selected = answer.messageKey;
              previous = "";
              await config.store.write(key,
                { turnID, state: "inflight", at: now(), messageKey: selected });
            }
          }
          if (selected !== undefined && answer !== null && answer.messageKey === selected) {
            if (!answer.text.startsWith(previous)) {
              yield await settle("uncertain", "candidate-rewritten");
              return;
            }
            const pending = answer.text.slice(previous.length);
            previous = answer.text;
            for (let offset = 0; offset < pending.length; offset += 4096) {
              yield { kind: "fragment", text: pending.slice(offset, offset + 4096) };
            }
            if (browser.completion?.(answer) === true) {
              yield await settle("complete", "dom-completion-proven");
              return;
            }
          }
          if (attempt + 1 < polls) await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        // DOM silence never proves completion; without a verified proof the
        // honest terminal stays uncertain.
        yield await settle("uncertain",
          selected === undefined ? "no-new-candidate" : "provider-finality-unverified");
      } finally {
        await browser.close();
      }
    },
  });
}
