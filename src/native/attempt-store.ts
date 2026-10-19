/** Durable per-prompt attempt index for the consented browser transport.
 *
 * This store is the anti-replay memory: an attempt is written BEFORE any UI
 * effect, so a crash or a model-call retry can never re-submit the same prompt
 * (the retry re-observes the recorded turn instead).
 *
 * The directory rule matches the G159 one-shot journal: it must be an existing,
 * private, operator-owned directory. A shared directory, a symlink or a
 * world-readable directory is refused instead of silently accepted. A corrupt
 * record refuses the turn (it is never treated as "no record", which would
 * allow a second send).
 */
import { randomBytes } from "node:crypto";
import { lstat, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  AttemptProgress, AttemptRecord, AttemptStore, BrowserTurnScope,
} from "./browser-turn-transport.js";

export const NATIVE_JOURNAL_DIR_OPT = "WEBBRIDGE_NATIVE_JOURNAL_DIR";
export const ATTEMPT_FILE_PREFIX = "attempt-";
const ATTEMPT_KEY = /^[a-f0-9]{64}$/;
const TURN_ID = /^[a-f0-9]{32}$/;
const MESSAGE_KEY = /^[\w:.-]{1,256}$/;
const REASON = /^[a-z][a-z-]{2,63}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SCOPE_ID = /^[A-Za-z0-9_-]{4,128}$/;

/** One valid record of the private journal, addressed by its prompt key. */
export interface JournalEntry {
  readonly key: string;
  readonly record: AttemptRecord;
}

/** The store plus the operator-only listing capability. */
export type FileAttemptStore = AttemptStore & {
  readonly list: () => Promise<readonly JournalEntry[]>;
};

const corrupt = () => new Error(
  "WebBridge native journal: corrupt attempt record; refusing to guess "
  + "(remove the file manually to proceed)");

/** Private directory rule shared with the G159 one-shot journal. */
export async function requirePrivateDirectory(dir: string): Promise<void> {
  if (typeof dir !== "string" || !dir.trim())
    throw new Error(`WebBridge native journal: directory required (${NATIVE_JOURNAL_DIR_OPT})`);
  let info;
  try { info = await lstat(dir); } catch {
    throw new Error(`WebBridge native journal: directory missing (${NATIVE_JOURNAL_DIR_OPT}=${dir})`);
  }
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0) ||
      (process.getuid && info.uid !== process.getuid()))
    throw new Error("WebBridge native journal: private operator-owned directory required "
      + `(${NATIVE_JOURNAL_DIR_OPT}=${dir})`);
}

function parseRecord(raw: string): AttemptRecord {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw corrupt(); }
  if (typeof parsed !== "object" || parsed === null) throw corrupt();
  const record = parsed as Record<string, unknown>;
  const { turnID, state, at, messageKey, progress, scope, reason } = record;
  if (typeof turnID !== "string" || !TURN_ID.test(turnID)) throw corrupt();
  if (state !== "inflight" && state !== "complete" && state !== "uncertain" && state !== "abandoned")
    throw corrupt();
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 0) throw corrupt();
  if (reason !== undefined && (typeof reason !== "string" || !REASON.test(reason))) throw corrupt();
  if (messageKey !== undefined && (typeof messageKey !== "string" || !MESSAGE_KEY.test(messageKey)))
    throw corrupt();
  let cursor: AttemptProgress | undefined;
  if (progress !== undefined) {
    if (typeof progress !== "object" || progress === null || Array.isArray(progress)) throw corrupt();
    const fields = progress as Record<string, unknown>;
    const { seq, length, hash } = fields;
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) throw corrupt();
    if (!Number.isSafeInteger(length) || (length as number) < 0) throw corrupt();
    if (typeof hash !== "string" || !DIGEST.test(hash)) throw corrupt();
    if (Object.keys(fields).some((field) => !["seq", "length", "hash"].includes(field)))
      throw corrupt();
    cursor = Object.freeze({ seq: seq as number, length: length as number, hash: hash as string });
  }
  let target: BrowserTurnScope | undefined;
  if (scope !== undefined) {
    if (typeof scope !== "object" || scope === null || Array.isArray(scope)) throw corrupt();
    const fields = scope as Record<string, unknown>;
    const { tabID, generation } = fields;
    if (typeof tabID !== "string" || !SCOPE_ID.test(tabID)) throw corrupt();
    if (!Number.isSafeInteger(generation) || (generation as number) < 0) throw corrupt();
    if (Object.keys(fields).some((field) => !["tabID", "generation"].includes(field)))
      throw corrupt();
    target = Object.freeze({ tabID: tabID as string, generation: generation as number });
  }
  return Object.freeze({
    turnID: turnID as string,
    state: state as AttemptRecord["state"],
    at: at as number,
    ...(reason === undefined ? {} : { reason: reason as string }),
    ...(messageKey === undefined ? {} : { messageKey: messageKey as string }),
    ...(cursor === undefined ? {} : { progress: cursor }),
    ...(target === undefined ? {} : { scope: target }),
  });
}

/** File-backed store: one JSON file per prompt key, atomic replace on write. */
export function createFileAttemptStore(dir: string): FileAttemptStore {
  const path = (key: string) => join(dir, ATTEMPT_FILE_PREFIX + key + ".json");
  const key = (value: string) => {
    if (!ATTEMPT_KEY.test(value)) throw new Error("WebBridge native journal: invalid attempt key");
    return value;
  };
  return Object.freeze({
    async read(promptKey: string): Promise<AttemptRecord | undefined> {
      await requirePrivateDirectory(dir);
      let raw: string;
      try { raw = await readFile(path(key(promptKey)), "utf8"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
      }
      return parseRecord(raw);
    },
    async write(promptKey: string, record: AttemptRecord): Promise<void> {
      await requirePrivateDirectory(dir);
      const target = path(key(promptKey));
      const temp = target + "." + randomBytes(8).toString("hex") + ".tmp";
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(record) + "\n");
        await file.sync();
      } finally { await file.close(); }
      await rename(temp, target); // atomic replace: a crash leaves the old record, never a gap
    },
    async discard(promptKey: string): Promise<void> {
      try { await unlink(path(key(promptKey))); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
    /** Operator view: every valid record of the private journal. Any unreadable
     *  or corrupt entry refuses the WHOLE listing: a partial view could hide an
     *  uncertain effect and let an operator conclude too early. */
    async list(): Promise<readonly JournalEntry[]> {
      await requirePrivateDirectory(dir);
      const names = (await readdir(dir))
        .filter((name) => name.startsWith(ATTEMPT_FILE_PREFIX) && name.endsWith(".json"))
        .sort();
      const entries: JournalEntry[] = [];
      for (const name of names) {
        const promptKey = name.slice(ATTEMPT_FILE_PREFIX.length, -".json".length);
        if (!ATTEMPT_KEY.test(promptKey)) throw corrupt();
        const raw = await readFile(join(dir, name), "utf8");
        entries.push(Object.freeze({ key: promptKey, record: parseRecord(raw) }));
      }
      return Object.freeze(entries);
    },
  });
}
