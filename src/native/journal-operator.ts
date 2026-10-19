/** Operator reconciliation of the durable native attempt journal.
 *
 * The transport never guesses an uncertain effect: a provisional attempt stays
 * reconcilable until it settles, and only an explicit OPERATOR attestation can
 * close it. This module makes that attestation strict and auditable:
 *  - exact target resolution only (full turn id, or one unambiguous key prefix);
 *  - no wildcard, no "all records" shortcut, no invented completion;
 *  - an abandoned attempt keeps its evidence but is never resumed onto again.
 * The assistant text is never stored nor printed by any of these helpers. */
import type { AttemptRecord, AttemptStore } from "./browser-turn-transport.js";
import type { JournalEntry } from "./attempt-store.js";

export type JournalInvocation =
  | { readonly action: "list"; readonly journalDir?: string }
  | { readonly action: "abandon"; readonly target: string; readonly journalDir?: string };

const ARG_FIELDS = ["abandon", "journal"] as readonly string[];
/** Full turn id (32 hex) or a key prefix: at least 8 characters, never a wildcard. */
const TARGET = /^[A-Za-z0-9_-]{8,64}$/;
const fail: (why: string) => never = (why) => { throw new Error("WebBridge journal refusal: " + why); };

/** Strict operator invocation: unknown/duplicate arguments and a target-less
 *  `--abandon` refuse loudly (a bare flag must never touch the whole journal). */
export function parseJournalInvocation(args: readonly string[]): JournalInvocation {
  const data: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i] ?? "";
    const name = key.startsWith("--") ? key.slice(2) : "";
    if (!ARG_FIELDS.includes(name) || Object.hasOwn(data, name)) fail("unknown or duplicate argument");
    if (i + 1 >= args.length) fail(`--${name} requires an explicit value`);
    data[name] = args[++i] ?? "";
  }
  const journalDir = data.journal === undefined ? undefined : data.journal.trim();
  if (journalDir === "") fail("--journal requires a non-empty directory");
  if (data.abandon === undefined) {
    return Object.freeze({
      action: "list",
      ...(journalDir === undefined ? {} : { journalDir }),
    });
  }
  if (!TARGET.test(data.abandon))
    fail("an explicit turn id or journal key prefix (8+ characters) is required");
  return Object.freeze({
    action: "abandon", target: data.abandon,
    ...(journalDir === undefined ? {} : { journalDir }),
  });
}

/** Exact resolution only: a full turn id, or one unambiguous key prefix. */
export function resolveJournalTarget(entries: readonly JournalEntry[], target: string): JournalEntry {
  const byTurn = entries.filter((entry) => entry.record.turnID === target);
  if (byTurn.length > 1) fail("target matches several records; use the journal key instead");
  if (byTurn.length === 1) return byTurn[0]!;
  const byKey = entries.filter((entry) => entry.key.startsWith(target));
  if (byKey.length > 1) fail("ambiguous target: several records share this prefix");
  if (byKey.length === 1) return byKey[0]!;
  return fail("unknown target: no attempt record matches");
}

/** Operator attestation: this provisional attempt must never be reconciled
 *  again. Idempotent; claims no completion and changes nothing else. */
export async function abandonJournalEntry(
  store: Pick<AttemptStore, "write">, entry: JournalEntry, now: number,
): Promise<{ readonly changed: boolean; readonly turnID: string }> {
  const { record } = entry;
  if (!Number.isSafeInteger(now) || now < 0) fail("invalid operator timestamp");
  if (record.state === "abandoned") return Object.freeze({ changed: false, turnID: record.turnID });
  const abandoned: AttemptRecord = Object.freeze({ ...record, state: "abandoned", at: now });
  await store.write(entry.key, abandoned);
  return Object.freeze({ changed: true, turnID: record.turnID });
}

/** One non-sensitive operator line per record: no assistant text, ever. */
export function describeJournalEntry(entry: JournalEntry, now: number): string {
  const { record } = entry;
  const age = Number.isSafeInteger(now) && now >= record.at ? Math.round((now - record.at) / 1000) : 0;
  return [
    "key=" + entry.key.slice(0, 16),
    "turn=" + record.turnID.slice(0, 16),
    "state=" + record.state,
    "reason=" + (record.reason ?? "-"),
    "message=" + (record.messageKey ?? "-"),
    "acked=" + (record.progress === undefined ? "-" : record.progress.seq + "/" + record.progress.length),
    "tab=" + (record.scope === undefined ? "-" : record.scope.tabID + "#" + record.scope.generation),
    "age=" + age + "s",
  ].join(" ");
}
