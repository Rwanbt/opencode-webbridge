/** Sub-agent safety for the opt-in read-only tools.
 *
 * Every call carries the INVOKING identity, is authorized with it, and is
 * refused when that identity is not verifiable. No grant is cached across calls
 * and no agent can elevate: the host decides per call. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { registerReadonlyTools } from "../src/runtime/readonly-tools.js";

interface Asserted { sessionID?: string; agent?: string; action?: string; resources?: string[] }
type Tool = {
  name: string;
  execute: (input: unknown, invocation: unknown) => Promise<{ content?: string } | undefined>;
};

const harness = (deny: (request: Asserted) => boolean = () => false) => {
  const asserted: Asserted[] = [];
  const tools: Tool[] = [];
  const ctx = {
    permission: {
      assert: async (request: Asserted) => {
        asserted.push(request);
        if (deny(request)) throw new Error("host policy denied this agent");
      },
    },
    tool: {
      transform: async (fn: (editor: { add: (tool: Tool) => void }) => void) => {
        await fn({ add: (tool: Tool) => { tools.push(tool); } });
        return { dispose: async () => {} };
      },
    },
  } as unknown as Plugin.Context;
  return { ctx, asserted, tools };
};
const invocation = (overrides: Record<string, unknown> = {}) => ({
  sessionID: "session-1", agent: "agent-1", messageID: "turn-1", id: "call-1",
  signal: new AbortController().signal, ...overrides,
});
const tempWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-subagent-"));
  return { raw: dir, root: await realpath(dir) };
};
const cleanup = (raw: string) => rm(raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
const ACTIVATED = { WEBBRIDGE_PERSONAL_READONLY_TOOLS: "1" };

test("a call without a verifiable identity is refused before any authorization", async () => {
  const workspace = await tempWorkspace();
  try {
    const { ctx, asserted, tools } = harness();
    await registerReadonlyTools(ctx, { ...ACTIVATED, WEBBRIDGE_PERSONAL_WORKSPACE: workspace.root });
    for (const broken of [{ sessionID: "" }, { agent: "a b" }, { messageID: undefined }, { id: "" }]) {
      await assert.rejects(tools[0]!.execute({ action: "git.status" }, invocation(broken)),
        /missing or invalid/, JSON.stringify(broken));
    }
    assert.equal(asserted.length, 0, "no authorization without a verifiable identity");
  } finally { await cleanup(workspace.raw); }
});

test("the invoking agent identity is the one authorized, on every call", async () => {
  const workspace = await tempWorkspace();
  try {
    await writeFile(join(workspace.root, "notes.txt"), "identity-bound\n");
    const { ctx, asserted, tools } = harness((request) => request.agent === "agent-2");
    await registerReadonlyTools(ctx, { ...ACTIVATED, WEBBRIDGE_PERSONAL_WORKSPACE: workspace.root });
    const first = await tools[0]!.execute({ action: "file.read", path: "notes.txt" }, invocation());
    assert.equal(first?.content, "identity-bound\n");
    await assert.rejects(tools[0]!.execute({ action: "file.read", path: "notes.txt" },
      invocation({ sessionID: "session-2", agent: "agent-2", messageID: "turn-2", id: "call-2" })),
      /host policy denied this agent/);
    assert.deepEqual(asserted.map((request) => [request.sessionID, request.agent]),
      [["session-1", "agent-1"], ["session-1", "agent-1"], ["session-2", "agent-2"]],
      "a denied agent gets no second attempt and no cached grant");
  } finally { await cleanup(workspace.raw); }
});

test("a cancelled invocation refuses before requesting any permission", async () => {
  const workspace = await tempWorkspace();
  try {
    const controller = new AbortController();
    controller.abort();
    const { ctx, asserted, tools } = harness();
    await registerReadonlyTools(ctx, { ...ACTIVATED, WEBBRIDGE_PERSONAL_WORKSPACE: workspace.root });
    await assert.rejects(tools[0]!.execute({ action: "git.status" },
      invocation({ signal: controller.signal })), /caller cancelled/);
    assert.equal(asserted.length, 0, "a cancelled branch of execution requests nothing");
  } finally { await cleanup(workspace.raw); }
});

test("each call re-authorizes: a previous grant never authorizes the next call", async () => {
  const workspace = await tempWorkspace();
  try {
    await writeFile(join(workspace.root, "notes.txt"), "again\n");
    const { ctx, asserted, tools } = harness();
    await registerReadonlyTools(ctx, { ...ACTIVATED, WEBBRIDGE_PERSONAL_WORKSPACE: workspace.root });
    for (const id of ["call-1", "call-2"]) {
      const result = await tools[0]!.execute({ action: "file.read", path: "notes.txt" }, invocation({ id }));
      assert.equal(result?.content, "again\n");
    }
    assert.equal(asserted.length, 4, "two authorizations (before and after) per call");
    assert.deepEqual(asserted.map((request) => request.action),
      ["webbridge.readonly.file.read", "webbridge.readonly.file.read",
        "webbridge.readonly.file.read", "webbridge.readonly.file.read"]);
  } finally { await cleanup(workspace.raw); }
});
