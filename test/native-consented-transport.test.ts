/** Unit evidence for the consent-gated production transport:
 *  - the environment declaration is validated strictly (loopback endpoint,
 *    explicit tab id, private journal directory): malformed declarations throw
 *    with an actionable message instead of degrading;
 *  - without a declared tab the transport is absent (the model refuses);
 *  - the durable attempt store is atomic and fails closed on a corrupt record;
 *  - a declared but unreachable browser refuses explicitly, sends nothing and
 *    leaves no attempt record behind.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileAttemptStore, requirePrivateDirectory } from "../src/native/attempt-store.js";
import { consentedTransport, nativeTabConsent } from "../src/native/consented-transport.js";
import { NATIVE_WEB_PROVIDERS } from "../src/native/registration.js";
import type { NativeTurnEvent, NativeTurnRequest } from "../src/native/turn-transport.js";

const CHATGPT = NATIVE_WEB_PROVIDERS.find((provider) => provider.id === "chatgpt")!;
const DEEPSEEK = NATIVE_WEB_PROVIDERS.find((provider) => provider.id === "deepseek")!;
const TAB = "ABCDEFGH_1234567890abcdef";
const KEY = "a".repeat(64);

const temp = async (prefix: string) => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, drop: () => rm(dir, { recursive: true, force: true, maxRetries: 3 }) };
};
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

test("no declared tab means no transport at all", async () => {
  assert.equal(nativeTabConsent({}, CHATGPT), null);
  assert.equal(await consentedTransport({}, CHATGPT), null);
});

test("a malformed tab declaration is refused with the expected shape", () => {
  const journal = "C:\\private-journal";
  const cases: Array<[string, RegExp]> = [
    [`http://127.0.0.1:9222`, /must be "<http:\/\/127\.0\.0\.1:port>#<tabID>"/],
    [`ftp://127.0.0.1:9222#${TAB}`, /explicit loopback debug endpoint/],
    [`http://10.0.0.5:9222#${TAB}`, /explicit loopback debug endpoint/],
    [`http://127.0.0.1:9222/extra#${TAB}`, /explicit loopback debug endpoint/],
    [`http://user:pass@127.0.0.1:9222#${TAB}`, /explicit loopback debug endpoint/],
    [`http://127.0.0.1:9222#bad!id`, /tab id is not a CDP target id/],
  ];
  for (const [raw, expected] of cases) {
    assert.throws(() => nativeTabConsent({ [CHATGPT.tabEnv]: raw }, CHATGPT), expected, raw);
  }
  assert.throws(
    () => nativeTabConsent({ [CHATGPT.tabEnv]: `http://127.0.0.1:9222#${TAB}` }, CHATGPT),
    /WEBBRIDGE_NATIVE_JOURNAL_DIR .* is required/);
  const consent = nativeTabConsent(
    { [CHATGPT.tabEnv]: `http://127.0.0.1:9222#${TAB} `, WEBBRIDGE_NATIVE_JOURNAL_DIR: journal }, CHATGPT);
  assert.deepEqual(consent, { endpoint: "http://127.0.0.1:9222", tabID: TAB, journalDir: journal });
});

test("a provider without a consented send primitive is refused, never faked", async () => {
  const { dir, drop } = await temp("webbridge-consent-");
  try {
    await assert.rejects(consentedTransport({
      [DEEPSEEK.tabEnv]: `http://127.0.0.1:9222#${TAB}`,
      WEBBRIDGE_NATIVE_JOURNAL_DIR: dir,
    }, DEEPSEEK), /no consented send primitive yet/);
  } finally { await drop(); }
});

test("the journal must be an existing private operator directory", async () => {
  const { dir, drop } = await temp("webbridge-journal-");
  try {
    await assert.rejects(requirePrivateDirectory(join(dir, "missing")), /directory missing/);
    const file = join(dir, "a-file");
    await writeFile(file, "x");
    await assert.rejects(requirePrivateDirectory(file), /private operator-owned directory/);
    if (process.platform !== "win32") {
      const open = join(dir, "open");
      await mkdir(open);
      await chmod(open, 0o755);
      await assert.rejects(requirePrivateDirectory(open), /private operator-owned directory/);
      await assert.rejects(consentedTransport({
        [CHATGPT.tabEnv]: `http://127.0.0.1:9222#${TAB}`,
        WEBBRIDGE_NATIVE_JOURNAL_DIR: open,
      }, CHATGPT), /private operator-owned directory/, "setup must refuse loudly, not at turn time");
    }
    const link = join(dir, "link");
    try {
      await symlink(dir, link, "dir");
      await assert.rejects(requirePrivateDirectory(link), /private operator-owned directory/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; // Windows without the privilege
    }
  } finally { await drop(); }
});

test("the attempt store round-trips atomically and fails closed on corruption", async () => {
  const { dir, drop } = await temp("webbridge-store-");
  try {
    const store = createFileAttemptStore(dir);
    assert.equal(await store.read(KEY), undefined);
    const record = { turnID: "b".repeat(32), state: "inflight" as const, at: 1_700_000_000_000 };
    await store.write(KEY, record);
    assert.deepEqual(await store.read(KEY), record);
    await store.write(KEY, { ...record, state: "uncertain", messageKey: "m2" });
    assert.deepEqual(await store.read(KEY), { ...record, state: "uncertain", messageKey: "m2" });
    assert.deepEqual(await readdir(dir), [`attempt-${KEY}.json`], "no temp file may survive a write");
    await assert.rejects(store.write("not-a-key", record), /invalid attempt key/);
    await writeFile(join(dir, `attempt-${KEY}.json`), "{ truncated");
    await assert.rejects(store.read(KEY), /corrupt attempt record/,
      "a corrupt record must refuse the turn, never read as 'no record'");
    await store.discard(KEY);
    assert.equal(await store.read(KEY), undefined);
    await store.discard(KEY); // idempotent
  } finally { await drop(); }
});

test("a declared but unreachable browser refuses, sends nothing and leaves no record", async () => {
  const { dir, drop } = await temp("webbridge-unreachable-");
  try {
    const port = await freePort(); // nothing listens on it anymore
    const env = {
      [CHATGPT.tabEnv]: `http://127.0.0.1:${port}#${TAB}`,
      WEBBRIDGE_NATIVE_JOURNAL_DIR: dir,
    };
    const transport = await consentedTransport(env, CHATGPT);
    assert.ok(transport, "a declared tab must produce a transport");
    const request: NativeTurnRequest = {
      providerID: CHATGPT.providerID, modelID: CHATGPT.modelID,
      prompt: "explain the failing test", signal: new AbortController().signal,
    };
    const stream = async () => {
      const events: NativeTurnEvent[] = [];
      for await (const event of transport.stream(request)) events.push(event);
      return events;
    };
    await assert.rejects(stream(), /no attached authorized browser session/);
    assert.deepEqual(await readdir(dir), [],
      "an unreachable browser sent nothing: the fresh attempt must be discarded");
    await assert.rejects(stream(), /no attached authorized browser session/,
      "the refusal must stay repeatable instead of deadlocking on a stale attempt");
    assert.deepEqual(await readdir(dir), []);
  } finally { await drop(); }
});
