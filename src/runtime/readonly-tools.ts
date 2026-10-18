/** Opt-in read-only workspace tools for the plugin root.
 *
 * Individual activation only (`WEBBRIDGE_PERSONAL_READONLY_TOOLS=1` + a declared
 * workspace directory). Every call is authorized by the core permission system
 * BEFORE and AFTER the read, so a revocation during the wait denies the output;
 * the workspace is confined by src/core/readonly-read.ts and no tool can write.
 * The registered tool is never an inference model. */
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import type { Plugin } from '@opencode/plugin';
import { createReadonlyReader } from '../core/readonly-read.js';
import type { ToolScope } from '../core/tool-proposal.js';

type Context = Plugin.Context;
const OPT = 'WEBBRIDGE_PERSONAL_READONLY_TOOLS';
const WORKSPACE_OPT = 'WEBBRIDGE_PERSONAL_WORKSPACE';
const fail = (reason: string): never =>
  { throw new Error('WebBridge read-only tools refused: ' + reason); };

export function readonlyToolsConfig(env: NodeJS.ProcessEnv) {
  if (env[OPT] !== '1') return null;
  const workspace = (env[WORKSPACE_OPT] ?? '').trim();
  if (!workspace) return fail(`${WORKSPACE_OPT} (absolute workspace directory) is required`);
  return Object.freeze({ workspace });
}

const Input = Schema.Struct({
  action: Schema.Literals(['file.read', 'git.status', 'git.diff', 'git.log']),
  path: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  staged: Schema.optional(Schema.Boolean),
});

/** Read-only workspace tools; the workspace root is re-verified on every call. */
export async function registerReadonlyTools(ctx: Context, env: NodeJS.ProcessEnv) {
  const config = readonlyToolsConfig(env);
  if (!config) return;
  const reader = createReadonlyReader({ workspace: config.workspace });
  // An opaque, stable workspace identity: the scope is never the raw path.
  const workspaceRef = 'ws-' + createHash('sha256').update(config.workspace).digest('hex').slice(0, 32);
  const registration = await ctx.tool.transform((editor) => editor.add({
    name: 'webbridge_readonly',
    description: 'Read-only workspace tools (file.read, git.status, git.diff, git.log) confined to the '
      + 'declared workspace. Requires OpenCode permission for every call; cannot write.',
    input: Input,
    async execute(input, invocation) {
      const scope: ToolScope = Object.freeze({
        sessionID: invocation.sessionID, agentID: invocation.agent,
        turnID: invocation.messageID, workspaceID: workspaceRef, callID: invocation.id,
      });
      const authorize = async () => {
        if (invocation.signal.aborted) return fail('caller cancelled');
        await ctx.permission.assert({
          sessionID: invocation.sessionID, agent: invocation.agent,
          action: 'webbridge.readonly.' + input.action, resources: [config.workspace],
          source: { type: 'tool', messageID: invocation.messageID, id: invocation.id },
        });
        if (invocation.signal.aborted) return fail('caller cancelled');
      };
      const args: Record<string, unknown> = {};
      if (input.path !== undefined) args.path = input.path;
      if (input.limit !== undefined) args.limit = input.limit;
      if (input.staged !== undefined) args.staged = input.staged;
      const proposal = { version: 1 as const, action: input.action, args, provenance: scope };
      await authorize();
      const result = await reader.execute(proposal, scope, invocation.signal);
      // Revocation during the wait denies the output: never return a read that
      // is no longer approved at the moment it completes.
      await authorize();
      return {
        content: result.output,
        metadata: {
          action: result.action, bytes: result.bytes, confinement: result.confinement,
          writeEnabled: false, workspace: config.workspace,
        },
      };
    },
  }));
  return () => registration.dispose();
}
