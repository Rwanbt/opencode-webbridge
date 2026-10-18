/** Production read-only workspace tools: activation gate, workspace confinement,
 *  size/DLP budgets, hardened Git reads, and the double authorization of every
 *  call (revocation during the wait denies the output). */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import { createReadonlyReader } from "../src/core/readonly-read.js";
import type { ToolProposal, ToolScope } from "../src/core/tool-proposal.js";
import { readonlyToolsConfig, registerReadonlyTools } from "../src/runtime/readonly-tools.js";

const scopeFor = (workspaceID = "ws-test"): ToolScope => Object.freeze({
  sessionID: "session-1", agentID: "agent-1", turnID: "turn-1", workspaceID, callID: "call-1",
});
const ask = (reader: ReturnType<typeof createReadonlyReader>,
  action: ToolProposal["action"], args: Record<string, unknown> = {}) =>
  reader.execute({ version: 1, action, args, provenance: scopeFor() }, scopeFor());
const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
const tempWorkspace = async () => {
  const dir = await mkdtemp(join(tmpdir(), "wb-readonly-"));
  return { raw: dir, root: await realpath(dir) }; // the declared workspace must be canonical
};

test("the tool set stays dormant unless individually activated with a workspace", () => {
  assert.equal(readonlyToolsConfig({}), null);
  assert.throws(() => readonlyToolsConfig({ WEBBRIDGE_PERSONAL_READONLY_TOOLS: "1" }),
    /absolute workspace directory/);
  const config = readonlyToolsConfig({
    WEBBRIDGE_PERSONAL_READONLY_TOOLS: "1", WEBBRIDGE_PERSONAL_WORKSPACE: "C:\\work",
  });
  assert.deepEqual(config, { workspace: "C:\\work" });
  assert.equal(Object.isFrozen(config), true);
});

test("file.read is confined to the canonical workspace and reports its proof level", async () => {
  const workspace = await tempWorkspace();
  try {
    await writeFile(join(workspace.root, "notes.txt"), "hello workspace\n");
    const reader = createReadonlyReader({ workspace: workspace.root });
    const result = await ask(reader, "file.read", { path: "notes.txt" });
    assert.equal(result.output, "hello workspace\n");
    assert.equal(result.bytes, 16);
    assert.equal(result.confinement, process.platform === "linux" ? "openat" : "realpath");
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("escapes, Git internals, oversized files and secret-looking output are refused", async () => {
  const workspace = await tempWorkspace();
  try {
    await writeFile(join(workspace.root, "big.txt"), "x".repeat(20_000));
    await writeFile(join(workspace.root, "creds.env"), "API_KEY=abcdef012345\n");
    await writeFile(join(workspace.root, "plain.txt"), "nothing sensitive\n");
    const outside = await tempWorkspace();
    const reader = createReadonlyReader({ workspace: workspace.root });
    for (const [path, expected] of [
      ["../outside.txt", /proposal denied|outside the workspace|resolved path/],
      [outside.root, /proposal denied|outside the workspace|resolved path/],
      [".git/config", /internal Git files are forbidden/],
      ["big.txt", /exceed(?:s|ed) the read budget/],
      ["creds.env", /secret-looking output refused/],
      ["missing.txt", /ENOENT/],
    ] as const) {
      await assert.rejects(ask(reader, "file.read", { path }), expected, path);
    }
    // A symlink pointing outside the workspace must never be followed.
    try {
      await symlink(join(outside.root, "plain.txt"), join(workspace.root, "link.txt"));
      await assert.rejects(ask(reader, "file.read", { path: "link.txt" }),
        /symlink\/reparse traversal denied/);
    } catch (error) {
      // Creating symlinks needs privileges on Windows: the escape test above still covers confinement.
      if (!/EPERM|UNKNOWN|privilege/i.test(String(error))) throw error;
    }
    await rm(outside.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("mutable actions and malformed proposals are refused before any read", async () => {
  const workspace = await tempWorkspace();
  try {
    const reader = createReadonlyReader({ workspace: workspace.root });
    await assert.rejects(
      reader.execute({ version: 1, action: "file.write", args: { path: "x" }, provenance: scopeFor() },
        scopeFor()), /proposal denied/);
    await assert.rejects(ask(reader, "file.read", {}), /proposal denied/);
    await assert.rejects(
      reader.execute({ version: 1, action: "file.read", args: { path: "x" }, provenance: scopeFor() },
        scopeFor("ws-other")), /proposal denied/);
    assert.throws(() => createReadonlyReader({ workspace: workspace.root, maxBytes: 4_000_000 }),
      /invalid resource budgets/);
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("Git reads are hardened, bounded and confined to the repository", async () => {
  const workspace = await tempWorkspace();
  try {
    const init = git(workspace.root, ["init", "-q"]);
    if (init.status !== 0) return; // no Git available: this environment cannot run the Git cases
    await writeFile(join(workspace.root, "a.txt"), "one\n");
    git(workspace.root, ["add", "a.txt"]);
    git(workspace.root, ["-c", "user.email=t@example.test", "-c", "user.name=T", "commit", "-q", "-m", "init"]);
    await writeFile(join(workspace.root, "a.txt"), "two\n");
    const reader = createReadonlyReader({ workspace: workspace.root });
    assert.match((await ask(reader, "git.status")).output, /a\.txt/);
    assert.match((await ask(reader, "git.log")).output, /init/);
    const diff = await ask(reader, "git.diff");
    assert.match(diff.output, /-one/);
    assert.match(diff.output, /\+two/);
    await assert.rejects(ask(reader, "git.diff", { path: "../escape.txt" }),
      /proposal denied|outside the workspace/);
    assert.equal((await ask(reader, "git.diff", { staged: true })).action, "git.diff");
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("a read outside a Git repository is explicit, never a fabricated answer", async () => {
  const workspace = await tempWorkspace();
  try {
    const reader = createReadonlyReader({ workspace: workspace.root });
    await assert.rejects(ask(reader, "git.status"), /unsafe Git repository/);
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("every registered call is authorized before AND after the read", async () => {
  const workspace = await tempWorkspace();
  try {
    await writeFile(join(workspace.root, "notes.txt"), "content\n");
    const declared: Array<{ action?: string; resources?: string[] }> = [];
    const added: Array<{ name: string; execute: (input: unknown, invocation: unknown) => Promise<unknown> }> = [];
    let asserts = 0;
    let denyAfterRead = false;
    const ctx = {
      permission: {
        assert: async (request: { action?: string; resources?: string[] }) => {
          asserts += 1;
          declared.push(request);
          // The 4th authorization is the post-read check of the second call.
          if (denyAfterRead && asserts === 4) throw new Error("permission revoked after the wait");
        },
      },
      tool: {
        transform: async (fn: (editor: { add: (tool: never) => void }) => void) => {
          await fn({ add: (tool: never) => { added.push(tool); } });
          return { dispose: async () => {} };
        },
      },
    } as unknown as Plugin.Context;
    const cleanup = await registerReadonlyTools(ctx, {
      WEBBRIDGE_PERSONAL_READONLY_TOOLS: "1", WEBBRIDGE_PERSONAL_WORKSPACE: workspace.root,
    });
    assert.equal(typeof cleanup, "function");
    assert.equal(added.length, 1);
    const invocation = {
      sessionID: "session-1", agent: "agent-1", messageID: "turn-1", id: "call-1",
      signal: new AbortController().signal,
    };
    const result = await added[0]!.execute({ action: "file.read", path: "notes.txt" }, invocation) as
      { content: string; metadata: Record<string, unknown> };
    assert.equal(result.content, "content\n");
    assert.equal(result.metadata.writeEnabled, false);
    assert.equal(result.metadata.action, "file.read");
    assert.equal(declared.length, 2, "authorization must bracket the read");
    assert.equal(declared[0]!.action, "webbridge.readonly.file.read");
    assert.deepEqual(declared[0]!.resources, [workspace.root]);

    denyAfterRead = true;
    await assert.rejects(added[0]!.execute({ action: "file.read", path: "notes.txt" }, invocation),
      /permission revoked after the wait/);
    await cleanup!();
  } finally {
    await rm(workspace.raw, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
